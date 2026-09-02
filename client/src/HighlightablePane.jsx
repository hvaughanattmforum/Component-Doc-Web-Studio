import React, { useEffect, useRef, useState } from 'react';

// Mirrors the server's repoOwnerAndName() (server/index.js) - needed here so
// the client can build a GitHub blob permalink without a round trip.
function parseGithubRemote(remoteUrl) {
  const m = remoteUrl && remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// Generic "highlight rows of rendered text -> permalink -> issue draft" pane
// - one row per line, each clickable, with a selection toolbar for copying a
// permalink (in-app and/or GitHub blob) or adding the range to the issue
// draft (see CreateIssuePanel.jsx). Originally built as YamlPane.jsx for the
// main component YAML only; generalized so the same mechanism covers the
// five hand-edited Diagrams/*.md files too (Links, the three Descriptions
// tables, and the Supplement) - each caller (App.jsx for the YAML, or
// LinksStep.jsx/DescriptionsStep.jsx/DocumentHistoryStep.jsx for their own
// file) supplies its own `text`, `relativePath` and `canPermalink`/
// `permalinkDisabledReason` rather than this component knowing anything
// about where any particular file lives or when it's considered "ready."
//
// `paneKey` disambiguates which pane a permalink's highlighted range belongs
// to (a component can have several of these open on one page at once, e.g.
// DescriptionsStep renders three) - an in-app permalink's `lines` only gets
// applied by the pane whose `paneKey` matches the URL's `pane` param (see
// initialSelectionPane/onInitialSelectionApplied, wired from App.jsx).
//
// `inline` switches between the sticky page-column layout (the YAML pane's
// original home, App.jsx's .shell third column) and a plain bordered block
// meant to sit inline within a step's own scrolling content (see
// .yaml-pane-inline in index.css) - sticking to the viewport only makes
// sense for the one pane that's meant to float alongside a whole wizard
// step, not one embedded partway down a step's own form.
export default function HighlightablePane({
  title,
  text,
  dirName,
  versionDir,
  relativePath,
  canPermalink,
  permalinkDisabledReason,
  repoInfo,
  step,
  paneKey,
  initialSelection,
  initialSelectionPane,
  onInitialSelectionApplied,
  onAddToIssueDraft,
  inline = false,
}) {
  // Markdown/YAML dumps always end with a trailing "\n", so a plain split()
  // would add one phantom empty "line" past the real end of the file - drop it.
  const rawLines = text.split('\n');
  const lines = rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;
  const [range, setRange] = useState(null); // { anchor, focus } - 1-indexed line numbers
  const [copied, setCopied] = useState(null); // 'app' | 'github' | null
  const firstSelectedRowRef = useRef(null);
  // Set when `range` was just seeded from a consumed permalink (as opposed
  // to a user click) - tells the scroll effect below to run once for that
  // seed and then get out of the way of the user's own scrolling.
  const pendingScrollRef = useRef(false);

  // Runs once per mount only (empty deps) - by design, since App.jsx clears
  // its `pendingSelection` state via onInitialSelectionApplied right after
  // the matching pane consumes it, so a later remount receives
  // initialSelection={null} and there's nothing left to re-seed. Only the
  // pane whose paneKey matches the permalink's own `pane` param claims it.
  useEffect(() => {
    if (paneKey && initialSelectionPane !== paneKey) return;
    if (initialSelection && initialSelection.start && initialSelection.end) {
      setRange({ anchor: initialSelection.start, focus: initialSelection.end });
      pendingScrollRef.current = true;
      onInitialSelectionApplied?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Depends on `range` (not `initialSelection`) so it actually re-runs on
  // the render where the seeded range takes effect and the target row's ref
  // is attached - `pendingScrollRef` keeps this from re-scrolling on every
  // later user-driven selection change.
  useEffect(() => {
    if (pendingScrollRef.current && firstSelectedRowRef.current) {
      firstSelectedRowRef.current.scrollIntoView({ block: 'center' });
      pendingScrollRef.current = false;
    }
  }, [range]);

  const start = range ? Math.min(range.anchor, range.focus) : null;
  const end = range ? Math.max(range.anchor, range.focus) : null;

  const handleLineClick = (lineNum, shiftKey) => {
    if (shiftKey && range) {
      setRange({ anchor: range.anchor, focus: lineNum });
      return;
    }
    if (range && start === lineNum && end === lineNum) {
      setRange(null); // toggle off - clicking the only selected line again
      return;
    }
    setRange({ anchor: lineNum, focus: lineNum });
    setCopied(null);
  };

  const appLink = canPermalink && start
    ? `${window.location.origin}${window.location.pathname}?open=${encodeURIComponent(dirName)}&version=${encodeURIComponent(versionDir)}&step=${step}&pane=${encodeURIComponent(paneKey)}&lines=${start}-${end}`
    : null;

  const identity = repoInfo?.git?.remoteUrl ? parseGithubRemote(repoInfo.git.remoteUrl) : null;
  const githubLink = canPermalink && start && identity && repoInfo.git.branch && relativePath
    ? `https://github.com/${identity.owner}/${identity.repo}/blob/${repoInfo.git.branch}/${relativePath}#L${start}-L${end}`
    : null;

  const copy = async (text, which) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
    } catch {
      // Clipboard access denied/unavailable - nothing sensible to do beyond
      // leaving the button un-confirmed.
    }
  };

  const addToDraft = () => {
    if (!start) return;
    onAddToIssueDraft({
      start,
      end,
      snippet: lines.slice(start - 1, end).join('\n'),
      appLink,
      githubLink,
    });
    setRange(null);
  };

  return (
    <div className={`yaml-pane ${inline ? 'yaml-pane-inline' : ''}`}>
      <div className="yaml-head"><b>{title}</b><span>read-only, updates as you edit</span></div>

      {range && (
        <div className="yaml-selection-bar">
          <span>Line{start === end ? ` ${start}` : `s ${start}-${end}`} selected</span>
          <div className="yaml-selection-actions">
            <button
              type="button"
              className="ghost"
              disabled={!canPermalink}
              title={permalinkDisabledReason}
              onClick={() => appLink && copy(appLink, 'app')}
            >
              {copied === 'app' ? 'Copied!' : 'Copy in-app link'}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={!canPermalink}
              title={permalinkDisabledReason || 'Only resolves once this branch has been pushed to GitHub.'}
              onClick={() => githubLink && copy(githubLink, 'github')}
            >
              {copied === 'github' ? 'Copied!' : 'Copy GitHub link'}
            </button>
            {/* data-keep-issue-draft-open: read by CreateIssuePanel.jsx's
                outside-click handler so clicking this button (which lives
                outside the popover's own DOM subtree) adds the entry without
                closing an already-open issue-draft popover first. */}
            <button type="button" data-keep-issue-draft-open onClick={addToDraft}>Add to issue draft</button>
            <button type="button" className="ghost" onClick={() => setRange(null)}>Clear</button>
          </div>
        </div>
      )}

      <div className="yaml-live">
        {lines.map((line, idx) => {
          const lineNum = idx + 1;
          const selected = start !== null && lineNum >= start && lineNum <= end;
          return (
            <div
              key={lineNum}
              ref={selected && lineNum === start ? firstSelectedRowRef : null}
              className={`yaml-line ${selected ? 'yaml-line-selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={(e) => handleLineClick(lineNum, e.shiftKey)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleLineClick(lineNum, e.shiftKey);
                }
              }}
            >
              <span className="yaml-linenum">{lineNum}</span>
              <span className="yaml-text">{line}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
