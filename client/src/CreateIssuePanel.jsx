import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// `description` (the "What needs doing?" field) always leads the body - it
// becomes part of the issue's original content in the same POST that
// creates it, never a separate comment (GitHub issues have exactly one
// body, set at creation; a comment would need a second API call after the
// fact, for no benefit here since the issue doesn't exist yet).
function defaultBodyFor(draft, description) {
  const entries = draft.map((entry) => {
    const header = entry.start === entry.end ? `Line ${entry.start}` : `Lines ${entry.start}-${entry.end}`;
    const links = [entry.appLink && `[Open in Studio](${entry.appLink})`, entry.githubLink && `[View on GitHub](${entry.githubLink})`]
      .filter(Boolean)
      .join(' · ');
    return `**${header}**${links ? ` - ${links}` : ''}\n\`\`\`yaml\n${entry.snippet}\n\`\`\``;
  }).join('\n\n');
  return description.trim() ? `${description.trim()}\n\n---\n\n${entries}` : entries;
}

// Collects permalinks added from YamlPane's selection toolbar (see
// YamlPane.jsx) and files them as a single GitHub issue via
// POST /api/github/issue. Same anchor + outside-click-close popover pattern
// as HelpButton.jsx, kept in the header next to it.
export default function CreateIssuePanel({ draft, onRemove, onClear, defaultTitle }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const anchorRef = useRef(null);

  // Title and body each regenerate from the current component/draft any time
  // it changes, but only until the user actually edits the field - same
  // "seed until touched" pattern for both, so switching to a different
  // component (title) or adding another highlighted snippet (body) keeps
  // reflecting that, right up until the user starts typing their own text.
  // Body's regeneration also picks up `description` (the free-text "what
  // needs doing" field, which has no default of its own to seed from - it's
  // pure user input), so typing there flows straight into the body preview
  // without needing its own edited-tracking flag.
  const [titleEdited, setTitleEdited] = useState(false);
  const [bodyEdited, setBodyEdited] = useState(false);
  useEffect(() => {
    if (!titleEdited) setTitle(defaultTitle);
  }, [defaultTitle, titleEdited]);
  useEffect(() => {
    if (!bodyEdited) setBody(defaultBodyFor(draft, description));
  }, [draft, description, bodyEdited]);
  useEffect(() => {
    if (!open) return undefined;
    const handleOutsideClick = (e) => {
      // Buttons outside this popover's own DOM (e.g. YamlPane's "Add to
      // issue draft") opt out of closing it via this attribute - otherwise
      // mousedown (which fires before their click handler) would close the
      // popover before the click that's supposed to update it even runs.
      if (e.target.closest('[data-keep-issue-draft-open]')) return;
      if (anchorRef.current && !anchorRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  if (draft.length === 0) return null;

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.createGithubIssue({ title, body });
      setResult({ ok: true, issueUrl: r.issueUrl, issueNumber: r.issueNumber });
      onClear();
      setTitleEdited(false);
      setDescription('');
      setBodyEdited(false);
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="help-anchor" ref={anchorRef}>
      <button type="button" className="help" onClick={() => setOpen((o) => !o)}>Issue draft ({draft.length})</button>
      {open && (
        <div className="help-box issue-draft-box">
          <ul className="issue-draft-list">
            {draft.map((entry) => (
              <li key={entry.id}>
                <span>{entry.start === entry.end ? `Line ${entry.start}` : `Lines ${entry.start}-${entry.end}`}</span>
                <button type="button" className="ghost" onClick={() => onRemove(entry.id)}>Remove</button>
              </li>
            ))}
          </ul>

          <label>
            Title
            <input type="text" value={title} onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }} />
          </label>
          <label>
            What needs doing? <span className="hint">goes at the top of the issue</span>
            <textarea
              rows={3}
              placeholder="Describe what needs to change or be reviewed..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Body
            <textarea rows={8} value={body} onChange={(e) => { setBody(e.target.value); setBodyEdited(true); }} />
          </label>

          {result && result.ok && (
            <div className="status-banner ok">
              Created <a href={result.issueUrl} target="_blank" rel="noreferrer">issue #{result.issueNumber}</a>.
            </div>
          )}
          {result && !result.ok && (
            <div className="status-banner error">{result.error}</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="primary" disabled={busy || !title.trim()} onClick={submit}>
              {busy ? 'Creating…' : 'Create GitHub issue'}
            </button>
            <button type="button" className="ghost" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
