// Component specification rules shared with the spec repo's
// component-specification-studio and component-version-increment skills, so
// a component saved here comes out the same as one written by those skills:
// the licence comment, the allowed status values, the naming scheme, the
// repo-wide next ID, and the version bump with its version folder handling.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';
import {
  componentChanges, maxLevel, bumpVersion, isSemver, compareVersions, reasonFor, folderAction,
} from './versioning.js';

// The TM Forum licence comment every component YAML carries directly below
// componentMetadata.id. yaml.dump drops comments, so it is re-inserted into
// the dumped text on every write. Same text and placement as
// ensureLicenceComment() in the studio skill's studio.js and the
// version-increment skill's version.js - change all three together.
export const LICENCE_COMMENT = '# Copyright © TM Forum 2026. Retain this notice and TM Forum attribution. '
  + 'Create derivative works, but do not modify the original asset. Provided AS IS. '
  + 'See TM Forum IPR Policy for complete notice.';

export function ensureLicenceComment(yamlText) {
  if (yamlText.includes(LICENCE_COMMENT)) return yamlText;
  const m = /(componentMetadata:\r?\n(?:[ \t].*\r?\n)*?)([ \t]+)id: .*?(\r?\n)/.exec(yamlText);
  if (!m) throw new Error('componentMetadata.id not found - cannot place the licence comment');
  const at = m.index + m[0].length;
  return yamlText.slice(0, at) + m[2] + LICENCE_COMMENT + m[3] + yamlText.slice(at);
}

// yaml.dump quotes a "YYYY-MM-DD" string to keep it from being read back as
// !!timestamp - unquote it to match how the files are hand-written.
function unquoteDate(yamlText) {
  return yamlText.replace(/^(\s*publicationDate:\s*)'(\d{4}-\d{2}-\d{2})'\s*$/gm, '$1$2');
}

// The one way component YAML text is produced, for every write path.
export function dumpComponentYaml(component) {
  return ensureLicenceComment(unquoteDate(yaml.dump(component, { sortKeys: false, lineWidth: -1, noArrayIndent: true })));
}

// componentMetadata.status lifecycle values - the schema only says "string",
// so this list is enforced here. Same list as the studio skill's yaml-shape.md.
export const STATUS_VALUES = ['backlog', 'roadmap', 'preview', 'production', 'not released'];

// Same patterns as the studio skill's studio.js.
export const NAME_PATTERNS = {
  dirName: [/^TMFC\d+-[A-Za-z0-9]+$/, 'TMFCnnn-Name, e.g. TMFC001-ProductCatalogManagement'],
  versionDir: [/^TMFC\d+-v\d+(\.\d+)*$/, 'TMFCnnn-vX.Y.Z, e.g. TMFC001-v2.4.0'],
  fileName: [/^TMFC\d+-[A-Za-z0-9]+\.yaml$/, 'TMFCnnn-Name.yaml'],
};

// Error message for the first value that breaks the naming scheme, or null.
// Only the keys actually passed are checked.
export function namingError(values) {
  for (const [key, value] of Object.entries(values)) {
    const [re, expected] = NAME_PATTERNS[key];
    if (typeof value !== 'string' || !re.test(value)) return `Invalid ${key} "${value}" - expected ${expected}`;
  }
  return null;
}

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 });
  } catch {
    return null;
  }
}

// Next ID across the whole repo: the working tree plus every local and
// remote-tracking branch, so IDs already claimed on unmerged branches aren't
// handed out again. TMFC9* IDs are ignored. Same rule as studio.js next-id.
export function nextComponentId(root, workingTreeDirNames) {
  const dirNames = new Set(workingTreeDirNames);
  git(root, ['fetch', '--quiet', '--prune', 'origin']); // best effort: offline uses the refs already present
  const refs = (git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']) || '').split('\n').filter(Boolean);
  for (const ref of refs) {
    for (const p of (git(root, ['ls-tree', '--name-only', ref, 'specifications/']) || '').split('\n').filter(Boolean)) {
      dirNames.add(path.posix.basename(p));
    }
  }
  let max = 0;
  for (const dirName of dirNames) {
    const m = dirName.match(/^TMFC(\d+)-/);
    if (m && !m[1].startsWith('9')) max = Math.max(max, parseInt(m[1], 10));
  }
  return `TMFC${String(max + 1).padStart(3, '0')}`;
}

function normalizeDates(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeDates(v)]));
  }
  return value;
}

const versionPrefix = (dirName) => `${dirName.split('-')[0]}-v`;
const versionOfDir = (dirName, versionDir) => versionDir.slice(versionPrefix(dirName).length);
const componentDir = (root, dirName) => path.join(root, 'specifications', dirName);

function localVersionDirs(root, dirName) {
  const dir = componentDir(root, dirName);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(versionPrefix(dirName)))
    .map((d) => d.name);
}

// The base version folder: the component's highest version folder on the
// base branch (baseRef, e.g. origin/main), i.e. its last released state.
// null when the base branch has no folder for it (a new component).
function baseVersionDir(root, dirName, baseRef) {
  const listing = git(root, ['ls-tree', '--name-only', `${baseRef}:specifications/${dirName}`]);
  if (listing === null) {
    if (git(root, ['rev-parse', '--verify', '--quiet', baseRef]) === null) {
      throw new Error(`Can't read ${baseRef} in this workspace, so the released version of ${dirName} is unknown.`);
    }
    return null;
  }
  const prefix = versionPrefix(dirName);
  const dirs = listing.split('\n').filter((d) => d.startsWith(prefix));
  dirs.sort((a, b) => compareVersions(b.slice(prefix.length), a.slice(prefix.length)));
  return dirs[0] || null;
}

// Works out the version a save of `component` needs, compared with the base
// version folder - the component-version-increment rule:
//   minor (2.4.0 -> 2.5.0, new folder): a mandatory API added/removed, its
//     required flag flipped, or its specification[] changed
//   patch (2.4.0 -> 2.4.1, folder renamed): any other change
// One bump per branch, highest level wins. A new component (nothing on the
// base branch) isn't bumped. `keepVersion` keeps an already-bumped folder
// whose level the changes no longer need, instead of reporting level-dropped.
export function versionImpact(root, dirName, component, { baseRef, keepVersion = false }) {
  const baseDir = baseVersionDir(root, dirName, baseRef);
  if (!baseDir) return { isNew: true };

  const baseText = git(root, ['show', `${baseRef}:specifications/${dirName}/${baseDir}/${dirName}.yaml`]);
  if (baseText === null) throw new Error(`No ${dirName}.yaml in ${baseDir} on ${baseRef}.`);
  const base = normalizeDates(yaml.load(baseText));
  const baseVersion = String(base?.spec?.componentMetadata?.version ?? versionOfDir(dirName, baseDir));
  if (!isSemver(baseVersion)) throw new Error(`The released version "${baseVersion}" of ${dirName} isn't X.Y.Z - fix it on ${baseRef} first.`);

  const warnings = [];
  const above = localVersionDirs(root, dirName)
    .filter((d) => compareVersions(versionOfDir(dirName, d), baseVersion) > 0)
    .sort((a, b) => compareVersions(versionOfDir(dirName, b), versionOfDir(dirName, a)));
  if (above.length > 1) warnings.push(`More than one version folder above ${baseDir}: ${above.join(', ')}. Using ${above[0]}.`);
  const workingVersionDir = above[0] || null;

  const changes = componentChanges(base, normalizeDates(component));
  let level = maxLevel(changes);
  let reason = reasonFor(changes, level);
  const workingVersion = workingVersionDir ? versionOfDir(dirName, workingVersionDir) : null;
  // The app saves the Links and Supplement files separately from the YAML,
  // and those edits can't be seen in a YAML comparison. A patch folder that
  // already exists on this branch is therefore kept even when the YAML alone
  // has nothing left to bump for.
  if (level === 'none' && workingVersion && bumpVersion(baseVersion, 'patch') === workingVersion) {
    level = 'patch';
    reason = 'earlier changes on this branch (e.g. the Links or Supplement file)';
  }

  let newVersion = bumpVersion(baseVersion, level);
  let newVersionDir = `${versionPrefix(dirName)}${newVersion}`;
  let action = folderAction(level, newVersionDir, workingVersionDir, (d) => versionOfDir(dirName, d));
  if (action === 'level-dropped' && keepVersion) {
    newVersion = workingVersion;
    newVersionDir = workingVersionDir;
    action = 'use';
    reason = `kept at ${workingVersion} on request (${reason})`;
  }
  return {
    isNew: false, baseVersionDir: baseDir, baseVersion, level, newVersion, newVersionDir, workingVersionDir, action, reason, changes, warnings,
  };
}

// Copies a version folder's component YAML and every Diagrams/Source/*.md
// (except the unused *_Descriptions.md files) into a new version folder -
// the same set the version-increment skill's new-version command copies.
function copyVersionFolder(root, dirName, fromDir, toDir) {
  const from = path.join(componentDir(root, dirName), fromDir);
  const to = path.join(componentDir(root, dirName), toDir);
  if (fs.existsSync(to)) throw new Error(`${toDir} already exists.`);
  fs.mkdirSync(path.join(to, 'Diagrams', 'Source'), { recursive: true });
  const yamlFile = `${dirName}.yaml`;
  if (fs.existsSync(path.join(from, yamlFile))) fs.copyFileSync(path.join(from, yamlFile), path.join(to, yamlFile));
  const sourceDir = path.join(from, 'Diagrams', 'Source');
  if (fs.existsSync(sourceDir)) {
    for (const f of fs.readdirSync(sourceDir)) {
      if (f.endsWith('.md') && !f.endsWith('_Descriptions.md')) fs.copyFileSync(path.join(sourceDir, f), path.join(to, 'Diagrams', 'Source', f));
    }
  }
}

// Moves the version folders the way impact.action says, before the write:
//   rename  - the release's folder becomes the patch folder
//   create  - a new minor folder, copied from the release's folder
//   promote - the branch's patch folder becomes a minor folder, and the
//             release's folder is restored from the base branch
//   use / none - nothing to move
export function applyFolderAction(root, dirName, impact, baseRef) {
  const { action, baseVersionDir: baseDir, workingVersionDir, newVersionDir } = impact;
  const dir = componentDir(root, dirName);
  if (action === 'rename') {
    fs.renameSync(path.join(dir, baseDir), path.join(dir, newVersionDir));
  } else if (action === 'create') {
    copyVersionFolder(root, dirName, baseDir, newVersionDir);
  } else if (action === 'promote') {
    copyVersionFolder(root, dirName, workingVersionDir, newVersionDir);
    fs.rmSync(path.join(dir, workingVersionDir), { recursive: true, force: true });
    if (git(root, ['checkout', baseRef, '--', `specifications/${dirName}/${baseDir}`]) === null) {
      throw new Error(`Could not restore ${baseDir} from ${baseRef}.`);
    }
  } else if (action === 'level-dropped') {
    throw new Error('level-dropped must be resolved before writing');
  }
}

// Where a Links or Supplement save for `versionDir` has to go. Editing the
// released folder itself is a patch change, so it is renamed to the patch
// version first (and its YAML's version updated); a folder this branch
// already bumped, or a new component's folder, is written as it is.
// Returns { versionDir, bumped } where bumped is { from, to } or null.
export function companionTarget(root, dirName, versionDir, baseRef) {
  const baseDir = baseVersionDir(root, dirName, baseRef);
  if (!baseDir || versionDir !== baseDir) return { versionDir, bumped: null };
  const above = localVersionDirs(root, dirName)
    .filter((d) => compareVersions(versionOfDir(dirName, d), versionOfDir(dirName, baseDir)) > 0)
    .sort((a, b) => compareVersions(versionOfDir(dirName, b), versionOfDir(dirName, a)));
  if (above[0]) return { versionDir: above[0], bumped: null };

  const yamlPath = path.join(componentDir(root, dirName), baseDir, `${dirName}.yaml`);
  const component = normalizeDates(yaml.load(fs.readFileSync(yamlPath, 'utf8')));
  const from = String(component.spec.componentMetadata.version);
  if (!isSemver(from)) throw new Error(`The released version "${from}" of ${dirName} isn't X.Y.Z - fix it first.`);
  const to = bumpVersion(from, 'patch');
  const newDir = `${versionPrefix(dirName)}${to}`;
  fs.renameSync(path.join(componentDir(root, dirName), baseDir), path.join(componentDir(root, dirName), newDir));
  component.spec.componentMetadata.version = to;
  fs.writeFileSync(path.join(componentDir(root, dirName), newDir, `${dirName}.yaml`), dumpComponentYaml(component), 'utf8');
  return { versionDir: newDir, bumped: { from, to, fromDir: baseDir, toDir: newDir } };
}

// True when versionDir is the released folder and nothing on this branch has
// bumped it yet - auto-created placeholder files mustn't land there.
export function isUnbumpedRelease(root, dirName, versionDir, baseRef) {
  return baseVersionDir(root, dirName, baseRef) === versionDir
    && !localVersionDirs(root, dirName).some((d) => compareVersions(versionOfDir(dirName, d), versionOfDir(dirName, versionDir)) > 0);
}
