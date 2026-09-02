import React, { useState } from 'react';
import { api } from './api.js';

// Lets a signed-in user switch to a different branch - including one they
// (or someone else) started in an earlier session, so work isn't stuck to
// whichever session/browser created it. Two different mechanisms depending
// on deployment mode (see repoInfo.specRepoUrl, from /api/health):
//
// - Hosted mode (specRepoUrl set - each user already has their own isolated
//   workspace clone, see ensureWorkspace in server/index.js): there's only
//   one checkout to switch, so this does a real `git checkout` in place via
//   /api/git/checkout, refusing (409) if there are uncommitted changes.
// - Legacy mode (shared REPO_ROOT, no per-user workspace): each branch gets
//   its own independent git worktree instead, so switching never touches -
//   or requires cleaning up - whatever's already checked out (and possibly
//   uncommitted) elsewhere.
export default function BranchSwitcher({ currentBranch, repoInfo, hasOpenWizard, onGoToReviewStep }) {
  const hosted = Boolean(repoInfo?.specRepoUrl);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [worktrees, setWorktrees] = useState([]); // [{ path, branch }] - legacy mode only
  const [branches, setBranches] = useState([]); // all branch names
  const [selected, setSelected] = useState('');
  const [error, setError] = useState(null);
  const [switching, setSwitching] = useState(false);
  // Set once the user clicks Switch, before anything actually happens - the
  // reload a successful switch triggers throws away any wizard edits that
  // were never written to disk via Save to Worktree, so this gates the real
  // switch behind an explicit "yes, discard that" confirmation instead of
  // firing immediately.
  const [confirming, setConfirming] = useState(false);

  const openPicker = () => {
    setOpen(true);
    setError(null);
    setLoading(true);
    const load = hosted
      ? api.gitBranches().then((br) => setBranches(br.branches))
      : Promise.all([api.gitWorktrees(), api.gitBranches()]).then(([wt, br]) => {
        setWorktrees(wt.worktrees);
        setBranches(br.branches);
      });
    load
      .then(() => setSelected(currentBranch))
      .catch((err) => setError(err.message || 'Failed to load branches'))
      .finally(() => setLoading(false));
  };

  const requestSwitch = () => {
    if (!selected || selected === currentBranch) { setOpen(false); return; }
    setConfirming(true);
  };

  const performSwitch = () => {
    setSwitching(true);
    setError(null);

    const request = hosted
      ? api.checkoutBranch(selected).then(async (r) => {
        if (!r.ok) return r;
        // Without this, the next Save/Push would compare the branch just
        // checked out against the session's own (stale or freshly
        // auto-generated) branch name, see a mismatch, and silently check
        // out/commit to THAT instead - see ensureSessionBranch in
        // server/index.js. Also clears any stale prUrl tied to the old name.
        return api.setBranchName(selected);
      })
      : (worktrees.find((w) => w.branch === selected)
        ? api.selectWorktree(worktrees.find((w) => w.branch === selected).path)
        : api.createWorktree(selected));

    request
      .then((r) => {
        if (!r.ok) { setError(r.error); setSwitching(false); return; }
        window.location.reload();
      })
      .catch((err) => { setError(err.message || 'Failed to switch branch'); setSwitching(false); });
  };

  if (!open) {
    return (
      <button type="button" className="ghost" onClick={openPicker} title="Work on a different branch">
        <code>{currentBranch}</code> &darr;
      </button>
    );
  }

  if (confirming) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', maxWidth: 420 }}>
        <span>
          Switching to <code>{selected}</code> reloads the page - any wizard edits you haven&apos;t clicked
          &quot;Save to Worktree&quot; for yet will be lost.
          {hasOpenWizard && onGoToReviewStep ? (
            <>
              {' '}Go to{' '}
              <button
                type="button"
                className="ghost"
                onClick={() => { setOpen(false); setConfirming(false); onGoToReviewStep(); }}
                disabled={switching}
              >
                Review &amp; Save
              </button>
              {' '}first to save or push them.
            </>
          ) : ' (already-saved-but-unpushed changes are safe - the switch is blocked until those are pushed or discarded.)'}
        </span>
        <button type="button" className="danger" onClick={performSwitch} disabled={switching}>
          {switching ? 'Switching…' : 'Switch anyway'}
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={switching}>Cancel</button>
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {loading ? (
        <span>Loading branches&hellip;</span>
      ) : (
        <>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={switching}>
            {branches.map((b) => {
              const hasWorktree = worktrees.some((w) => w.branch === b);
              return <option key={b} value={b}>{b}{hasWorktree ? ' (open)' : ''}</option>;
            })}
          </select>
          <button type="button" className="primary" onClick={requestSwitch} disabled={switching || selected === currentBranch}>
            {switching ? 'Switching…' : 'Switch'}
          </button>
          <button type="button" onClick={() => setOpen(false)} disabled={switching}>Cancel</button>
        </>
      )}
      {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
    </span>
  );
}
