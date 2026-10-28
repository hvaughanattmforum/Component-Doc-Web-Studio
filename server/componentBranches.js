// One working branch per component, named the way the spec repo's
// component-specification-studio skill names its branches:
//   component/TMFCnnn-<version>-<slug>
// A signed-in user's workspace can hold edits to several components at once,
// so a push commits only one component's folder (specifications/<dirName>)
// onto that component's own branch. The commit is built in a throwaway index
// from the branch's current tip (or the base branch for a new branch), so
// HEAD, the real index and the working tree are never touched - edits to the
// other components stay where they are.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

export const COMPONENT_BRANCH = /^component\/(TMFC\d+)-(\d+\.\d+\.\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

const componentId = (dirName) => String(dirName).split('-')[0];

// Error message when `branch` isn't a valid working branch for `dirName`, or
// null.
export function componentBranchError(branch, dirName) {
  const m = COMPONENT_BRANCH.exec(String(branch));
  if (!m) {
    return `'${branch}' doesn't follow component/TMFCnnn-<version>-<description>, e.g. component/TMFC002-1.2.0-add-tmf622-v5 (lowercase words joined by hyphens)`;
  }
  if (m[1] !== componentId(dirName)) {
    return `'${branch}' is for ${m[1]}, but this component is ${componentId(dirName)}`;
  }
  return null;
}

// The component folder a component/TMFCnnn-... branch holds, read from the
// branch's own tree (ref), or null.
export function componentDirOnRef(root, ref, branch) {
  const m = COMPONENT_BRANCH.exec(String(branch));
  if (!m) return null;
  let listing;
  try {
    listing = execFileSync('git', ['ls-tree', '--name-only', ref, 'specifications/'], { cwd: root, encoding: 'utf8' });
  } catch {
    return null;
  }
  const dirs = listing.split('\n').map((p) => path.posix.basename(p.trim())).filter((d) => d.startsWith(`${m[1]}-`));
  return dirs.length === 1 ? dirs[0] : null;
}

function revParse(root, ref) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

// Commits the working tree's specifications/<dirName> onto refs/heads/<branch>.
// The parent is origin's copy of the branch when it exists, else the local
// branch, else baseRef (a branch not yet pushed). `expectedTip` is the commit
// this session last pushed to the branch: if origin's tip has moved past it,
// someone else pushed, and this refuses rather than overwrite their work.
// Returns { committed: false } when the folder already matches the parent.
export function commitComponent(root, {
  dirName, branch, baseRef, message, author, expectedTip = null,
}) {
  const remoteTip = revParse(root, `refs/remotes/origin/${branch}`);
  if (expectedTip && remoteTip && remoteTip !== expectedTip) {
    const err = new Error(`Someone else has pushed to ${branch} since your last push. Nothing was pushed - resume the branch with the branch switcher to pick up their changes first.`);
    err.code = 'branch-moved';
    throw err;
  }
  const parent = remoteTip || revParse(root, `refs/heads/${branch}`) || revParse(root, baseRef);
  if (!parent) throw new Error(`Can't read ${baseRef} in this workspace.`);

  const tree = treeWithComponent(root, dirName, parent);
  if (tree === treeOf(root, parent)) return { committed: false, parent };
  const sha = execFileSync('git', [
    '-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`,
    'commit-tree', tree, '-p', parent, '-m', message,
  ], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['update-ref', `refs/heads/${branch}`, sha], { cwd: root, encoding: 'utf8' });
  return { committed: true, sha, parent };
}

// True when the working tree's specifications/<dirName> (untracked files
// included) is exactly what `ref` holds - nothing would be lost by
// replacing it.
export function componentMatches(root, dirName, ref) {
  return treeWithComponent(root, dirName, ref) === treeOf(root, ref);
}

const treeOf = (root, ref) => execFileSync('git', ['rev-parse', `${ref}^{tree}`], { cwd: root, encoding: 'utf8' }).trim();

// The tree of `ref` with specifications/<dirName> replaced by the working
// tree's copy, built in a throwaway index.
function treeWithComponent(root, dirName, ref) {
  const indexFile = path.join(os.tmpdir(), `oda-studio-index-${crypto.randomUUID()}`);
  const git = (args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: indexFile },
  }).trim();
  try {
    git(['read-tree', ref]);
    git(['add', '-A', '--', `specifications/${dirName}`]);
    return git(['write-tree']);
  } finally {
    fs.rmSync(indexFile, { force: true });
  }
}

// Replaces the working tree's specifications/<dirName> with its state on
// `ref`, leaving every other component alone - how a component branch is
// resumed without moving HEAD.
export function restoreComponent(root, dirName, ref) {
  const rel = `specifications/${dirName}`;
  fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  execFileSync('git', ['checkout', ref, '--', rel], { cwd: root, encoding: 'utf8' });
  // checkout stages what it restores; unstage it so the folder reads as
  // ordinary edits against HEAD, like any other unpushed work.
  execFileSync('git', ['reset', '--quiet', '--', rel], { cwd: root, encoding: 'utf8' });
}
