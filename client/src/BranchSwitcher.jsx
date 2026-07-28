import React, { useState } from 'react';
import { api } from './api.js';

// Lets a signed-in user work on more than one branch at once: each branch
// gets its own independent git worktree (a separate working folder checked
// out to that branch) rather than switching a single checkout in place, so
// picking a different branch here never touches - or requires cleaning up -
// whatever's already checked out (and possibly uncommitted) elsewhere.
export default function BranchSwitcher({ currentBranch }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [worktrees, setWorktrees] = useState([]); // [{ path, branch }]
  const [branches, setBranches] = useState([]); // all branch names, worktree or not
  const [selected, setSelected] = useState('');
  const [error, setError] = useState(null);
  const [switching, setSwitching] = useState(false);

  const openPicker = () => {
    setOpen(true);
    setError(null);
    setLoading(true);
    Promise.all([api.gitWorktrees(), api.gitBranches()])
      .then(([wt, br]) => {
        setWorktrees(wt.worktrees);
        setBranches(br.branches);
        setSelected(currentBranch);
      })
      .catch((err) => setError(err.message || 'Failed to load branches'))
      .finally(() => setLoading(false));
  };

  const doSwitch = () => {
    if (!selected || selected === currentBranch) { setOpen(false); return; }
    setSwitching(true);
    setError(null);
    const existing = worktrees.find((w) => w.branch === selected);
    const request = existing ? api.selectWorktree(existing.path) : api.createWorktree(selected);
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
          <button type="button" className="primary" onClick={doSwitch} disabled={switching || selected === currentBranch}>
            {switching ? 'Switching…' : 'Switch'}
          </button>
          <button type="button" onClick={() => setOpen(false)} disabled={switching}>Cancel</button>
        </>
      )}
      {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
    </span>
  );
}
