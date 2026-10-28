// Copied unchanged from the spec repo's
// skills/component-version-increment/scripts/versioning.js, so the app and
// the component-specification-studio skill bump versions by the same rule -
// change both together.
//
// Version-increment rule for ODA component specs (pure functions, no I/O).
// Compares a proposed component object with a base one and works out how
// far componentMetadata.version must move:
//   minor (X.Y+1.0): a mandatory API (required: true on either side) in
//                    exposedAPIs/dependentAPIs is added or removed, its
//                    required flag flips, or its specification[] (versions,
//                    resources, operations) changes
//   patch (X.Y.Z+1): any other change, including cosmetic edits (name,
//                    apiSDO, ...) to a mandatory API
//   none:            nothing changed
// componentMetadata.version itself is never counted as a change.

export const BUMP_LEVELS = ['none', 'patch', 'minor'];
const TAXONOMY_FIELDS = ['eTOMs', 'SIDs', 'functionalFrameworkFunctions'];
const API_LISTS = ['exposedAPIs', 'dependentAPIs'];
const EVENT_LISTS = ['publishedEvents', 'subscribedEvents'];

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

const deepEqual = (a, b) => stableStringify(a) === stableStringify(b);

function changedKeys(a, b) {
  const x = a ?? {};
  const y = b ?? {};
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => !deepEqual(x[k], y[k]));
}

// Keys entries by id; a repeated or missing id (older event entries) gets an
// occurrence suffix so no entry is silently dropped.
function keyById(list) {
  const seen = {};
  return new Map((Array.isArray(list) ? list : []).map((item, i) => {
    const id = item && typeof item === 'object' && item.id ? String(item.id) : `#${i + 1}`;
    seen[id] = (seen[id] || 0) + 1;
    return [seen[id] > 1 ? `${id}#${seen[id]}` : id, item];
  }));
}

const isRequired = (api) => api?.required === true;

function diffApiList(listName, baseList, newList, changes) {
  const before = keyById(baseList);
  const after = keyById(newList);
  const field = (key) => `spec.coreFunction.${listName}[${key}]`;
  for (const [key, api] of after) {
    const old = before.get(key);
    const mandatory = isRequired(api) || isRequired(old);
    if (!old) {
      changes.push({ field: field(key), change: `added (required: ${isRequired(api)})`, level: mandatory ? 'minor' : 'patch' });
    } else if (isRequired(old) !== isRequired(api)) {
      changes.push({ field: field(key), change: `required changed ${isRequired(old)} -> ${isRequired(api)}`, level: 'minor' });
    } else if (!deepEqual(old, api)) {
      const keys = changedKeys(old, api);
      const substantive = mandatory && keys.includes('specification');
      changes.push({ field: field(key), change: `modified (${keys.join(', ')})`, level: substantive ? 'minor' : 'patch' });
    }
  }
  for (const [key, old] of before) {
    if (!after.has(key)) {
      changes.push({ field: field(key), change: `removed (required: ${isRequired(old)})`, level: isRequired(old) ? 'minor' : 'patch' });
    }
  }
}

function diffListById(fieldPath, baseList, newList, changes) {
  const before = keyById(baseList);
  const after = keyById(newList);
  for (const [key, item] of after) {
    if (!before.has(key)) changes.push({ field: `${fieldPath}[${key}]`, change: 'added', level: 'patch' });
    else if (!deepEqual(before.get(key), item)) changes.push({ field: `${fieldPath}[${key}]`, change: 'modified', level: 'patch' });
  }
  for (const key of before.keys()) {
    if (!after.has(key)) changes.push({ field: `${fieldPath}[${key}]`, change: 'removed', level: 'patch' });
  }
}

function diffTaxonomy(fieldName, baseList, newList, changes) {
  const field = `spec.componentMetadata.${fieldName}`;
  const b = Array.isArray(baseList) ? baseList : [];
  const n = Array.isArray(newList) ? newList : [];
  // Multiset difference, so adding a line that is already listed shows up
  // as an addition (a duplicate) rather than a reorder.
  const count = (list) => list.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const before = count(b);
  const after = count(n);
  const surplus = (x, y) => [...x].flatMap(([l, c]) => Array(Math.max(0, c - (y.get(l) || 0))).fill(l));
  const added = surplus(after, before);
  const removed = surplus(before, after);
  added.forEach((l) => changes.push({ field, change: `added ${l}${before.has(l) ? ' (duplicate)' : ''}`, level: 'patch' }));
  removed.forEach((l) => changes.push({ field, change: `removed ${l}`, level: 'patch' }));
  if (!added.length && !removed.length && !deepEqual(b, n)) {
    changes.push({ field, change: 'reordered', level: 'patch' });
  }
}

// Key-level diff of two objects, skipping keys handled elsewhere.
function diffKeys(prefix, a, b, skip, changes) {
  for (const k of changedKeys(a, b)) {
    if (skip.includes(k)) continue;
    const change = a?.[k] === undefined ? 'added' : b?.[k] === undefined ? 'removed' : 'modified';
    changes.push({ field: `${prefix}${k}`, change, level: 'patch' });
  }
}

// Every changed field between two component objects, as
// [{ field, change, level }].
export function componentChanges(base, proposed) {
  const changes = [];
  const bSpec = base?.spec ?? {};
  const pSpec = proposed?.spec ?? {};
  const bCore = bSpec.coreFunction ?? {};
  const pCore = pSpec.coreFunction ?? {};
  const bMeta = bSpec.componentMetadata ?? {};
  const pMeta = pSpec.componentMetadata ?? {};
  for (const list of API_LISTS) diffApiList(list, bCore[list], pCore[list], changes);
  for (const list of EVENT_LISTS) diffListById(`spec.coreFunction.${list}`, bCore[list], pCore[list], changes);
  diffKeys('spec.coreFunction.', bCore, pCore, [...API_LISTS, ...EVENT_LISTS], changes);
  for (const f of TAXONOMY_FIELDS) diffTaxonomy(f, bMeta[f], pMeta[f], changes);
  diffKeys('spec.componentMetadata.', bMeta, pMeta, ['version', ...TAXONOMY_FIELDS], changes);
  diffKeys('spec.', bSpec, pSpec, ['coreFunction', 'componentMetadata'], changes);
  diffKeys('', base, proposed, ['spec'], changes);
  return changes;
}

export function maxLevel(changes) {
  return changes.reduce((acc, c) => (BUMP_LEVELS.indexOf(c.level) > BUMP_LEVELS.indexOf(acc) ? c.level : acc), 'none');
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/i;

export function isSemver(version) {
  return SEMVER.test(String(version));
}

export function bumpVersion(version, level) {
  const m = String(version).match(SEMVER);
  if (!m) throw new Error(`"${version}" is not a X.Y.Z version - fix componentMetadata.version first`);
  const [x, y, z] = m.slice(1).map(Number);
  if (level === 'minor') return `${x}.${y + 1}.0`;
  if (level === 'patch') return `${x}.${y}.${z + 1}`;
  return `${x}.${y}.${z}`;
}

export function compareVersions(a, b) {
  const toParts = (v) => String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = toParts(a);
  const pb = toParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function reasonFor(changes, level) {
  const drivers = changes.filter((c) => c.level === level).map((c) => `${c.field}: ${c.change}`);
  if (level === 'minor') return `mandatory API change - ${drivers.join('; ')}`;
  if (level === 'patch') return `non-mandatory change - ${drivers.join('; ')}`;
  return 'no change';
}

// What to do with the version folder, given the bump the branch needs
// (newVersionDir) and the bumped folder this branch already has, if any.
// A patch bump replaces the release's folder (the repo keeps only the
// latest patch of each X.Y); a minor bump gets a folder of its own.
//   none          nothing changed and no bumped folder exists
//   rename        patch: git mv <base> <newVersionDir>, then write there
//   create        minor: new-version <base> <newVersionDir>, then write there
//   use           the bumped folder already has the right version
//   promote       a patch folder exists but a minor bump is now needed:
//                 new-version <working> <newVersionDir>, git rm -r <working>,
//                 restore <base> from origin/main, then write
//   level-dropped the bumped folder is above what the changes now need;
//                 ask the user before moving it back down
export function folderAction(level, newVersionDir, workingVersionDir, versionOf) {
  if (level === 'none') return workingVersionDir ? 'level-dropped' : 'none';
  if (!workingVersionDir) return level === 'minor' ? 'create' : 'rename';
  if (workingVersionDir === newVersionDir) return 'use';
  const lower = compareVersions(versionOf(workingVersionDir), versionOf(newVersionDir)) < 0;
  return lower && level === 'minor' ? 'promote' : 'level-dropped';
}

// The commit message for one write set. `impact` is the result against the
// base folder; `commitChanges` are the changes against the pre-write state
// of the folder being written to; `fromVersion` is that folder's version.
// Bump commits (rename/create/promote) end with a "Base-Version:" git
// trailer, so a later session reads the branch's base back from history
// instead of re-deriving it from an origin/main that may have moved on.
export function formatCommitMessage({ id, summary, impact, commitChanges, fromVersion, companions = [] }) {
  const {
    baseVersion, newVersion, level, action, reason, baseVersionDir, newVersionDir, workingVersionDir, staleArtifacts = [],
  } = impact;
  const versionChanges = fromVersion !== newVersion;
  const title = versionChanges
    ? `${id}: ${summary} (v${fromVersion} -> v${newVersion})`
    : `${id}: ${summary} (v${newVersion})`;
  const versionBlock = ['rename', 'create', 'promote'].includes(action)
    ? [`Version bump: ${baseVersion} -> ${newVersion} (${level})`, `Reason: ${reason}`]
    : level === 'none'
      ? [`Version: ${newVersion} (no version change)`]
      : [`Version: ${newVersion} (unchanged by this commit; ${level} bump already applied)`, `Reason: ${reason}`];
  const lines = commitChanges.map((c) => `- ${c.field}: ${c.change}`);
  if (versionChanges) lines.push(`- spec.componentMetadata.version: ${fromVersion} -> ${newVersion}`);
  if (action === 'rename') lines.push(`- ${baseVersionDir}/: renamed to ${newVersionDir}/`);
  if (action === 'create') lines.push(`- ${newVersionDir}/: created from ${baseVersionDir} (YAML + Diagrams/Source)`);
  if (action === 'promote') {
    lines.push(`- ${workingVersionDir}/: replaced by ${newVersionDir}/ (${baseVersionDir} restored from origin/main)`);
  }
  companions.forEach((c) => lines.push(`- ${c}`));
  const sections = [[title], versionBlock, ['Changed fields:', ...(lines.length ? lines : ['- (none)'])]];
  if (action === 'rename' && staleArtifacts.length) {
    sections.push([`Not regenerated (still v${baseVersion}):`, ...staleArtifacts.map((a) => `- ${a}`)]);
  }
  if (['rename', 'create', 'promote'].includes(action)) sections.push([`Base-Version: ${baseVersionDir}`]);
  return sections.map((lines) => lines.join('\n')).join('\n\n') + '\n';
}
