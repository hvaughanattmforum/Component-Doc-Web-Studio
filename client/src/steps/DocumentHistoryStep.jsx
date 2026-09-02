import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import HighlightablePane from '../HighlightablePane.jsx';
import { renderSupplementMarkdown } from '../renderMarkdown.js';

// Only the last few rows of the version/release history tables stay
// editable - once an entry is superseded by newer ones it's frozen, matching
// how a real change log is meant to work (recent entries can still be
// tweaked while they're being written up; settled history isn't rewritten).
const EDITABLE_HISTORY_ROWS = 3;

function blankRow(columns) {
  return columns.map(() => '');
}

// One table (version history / release history / acknowledgements). The
// last `editableCount` rows (Infinity = all of them) get inputs and a Remove
// button; earlier rows render as plain read-only cells - there's no
// front-end control that can touch them.
function HistoryTable({ columns, rows, editableCount, onChange }) {
  const lockedCount = Math.max(0, rows.length - editableCount);

  const updateCell = (rowIdx, colIdx, value) => {
    const next = rows.map((r) => r.slice());
    next[rowIdx][colIdx] = value;
    onChange(next);
  };
  const addRow = () => onChange([...rows, blankRow(columns)]);
  const removeRow = (rowIdx) => onChange(rows.filter((_, i) => i !== rowIdx));

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table className="history-table">
          <thead>
            <tr>
              {columns.map((c) => <th key={c}>{c}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const locked = i < lockedCount;
              return (
                <tr key={i}>
                  {columns.map((_, j) => (
                    <td key={j} className={locked ? 'locked' : undefined}>
                      {locked ? (row[j] || '')
                        : <input type="text" value={row[j] || ''} onChange={(e) => updateCell(i, j, e.target.value)} />}
                    </td>
                  ))}
                  <td className="remove-cell">
                    {!locked && <button type="button" className="remove" onClick={() => removeRow(i)}>Remove</button>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="hint">No rows yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <button type="button" className="save" onClick={addRow} style={{ marginTop: 8 }}>+ Add row</button>
    </>
  );
}

// Editor for specifications/<dirName>/Diagrams/<ID>_<Name>_Supplement.md -
// replaces the old raw-markdown Supplement tab with a structured view, in
// the same one-card-per-concern / per-card-Save style as the Links tab.
// Chapter headings, the acknowledgements intro sentence, and table column
// headers are displayed but never editable here (the server re-attaches
// them from the existing file on every save regardless of what's sent) -
// only the Jira references/Further resources text and the tables' rows are
// ever written from this UI. Only meaningful once a component directory
// exists on disk, so this is hidden while creating a brand-new (not yet
// saved) component.
export default function DocumentHistoryStep({
  dirName, versionDir,
  repoInfo, step, pendingSelection, pendingSelectionPane, onInitialSelectionApplied, onAddToIssueDraft,
}) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { ok, error? }
  // Which card's Save button triggered the in-flight/last save, so feedback
  // shows next to that card - there's one file (and one save call) behind
  // every card, but each card gets its own visible Save button.
  const [activeCard, setActiveCard] = useState(null);
  // The exact markdown text of the most recently loaded-or-saved snapshot -
  // see the same pattern in App.jsx (savedYamlText/isDirty) and
  // LinksStep.jsx/DescriptionsStep.jsx (savedText/isDirty).
  const [savedText, setSavedText] = useState(null);

  useEffect(() => {
    setData(null);
    setResult(null);
    setSavedText(null);
    if (!dirName || !versionDir) return;
    api.componentSupplement(dirName, versionDir).then((d) => {
      if (d.exists) {
        setData({ ...d, justCreated: false });
        setSavedText(renderSupplementMarkdown(d, d.meta));
        return;
      }
      // No Supplement.md yet for this component - seed it from the standard
      // template right away, matching the old Supplement tab's behavior.
      const payload = {
        jiraBody: d.jiraBody,
        furtherBody: d.furtherBody,
        versionHistoryRows: d.versionHistory.rows,
        releaseHistoryRows: d.releaseHistory.rows,
        acknowledgementsRows: d.acknowledgements.rows,
      };
      api.saveComponentSupplement(dirName, versionDir, payload)
        .then((res) => {
          setData({ ...d, exists: true, path: res.path, justCreated: true });
          setSavedText(renderSupplementMarkdown(d, d.meta));
        })
        .catch((err) => {
          setData(d);
          setResult({ ok: false, error: `Could not auto-create the Supplement file: ${err.message}` });
        });
    }).catch((err) => setResult({ ok: false, error: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirName, versionDir]);

  if (!dirName || !versionDir) {
    return (
      <div className="panel panel-white">
        <h3 style={{ marginTop: 0 }}>Document History</h3>
        <p className="hint">Available once this component has been saved at least once.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="panel panel-white">
        <h3 style={{ marginTop: 0 }}>Document History</h3>
        <div className="hint">Loading...</div>
      </div>
    );
  }

  const save = async (cardKey) => {
    setActiveCard(cardKey);
    setSaving(true);
    setResult(null);
    try {
      const res = await api.saveComponentSupplement(dirName, versionDir, {
        jiraBody: data.jiraBody,
        furtherBody: data.furtherBody,
        versionHistoryRows: data.versionHistory.rows,
        releaseHistoryRows: data.releaseHistory.rows,
        acknowledgementsRows: data.acknowledgements.rows,
      });
      if (res.ok) {
        setResult({ ok: true });
        setData({ ...data, exists: true, path: res.path });
        setSavedText(renderSupplementMarkdown(data, data.meta));
      } else {
        setResult({ ok: false, error: res.error || 'Save failed' });
      }
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally {
      setSaving(false);
    }
  };

  const previewText = renderSupplementMarkdown(data, data.meta);
  const isDirty = savedText !== null && previewText !== savedText;
  const canPermalink = data.exists && !isDirty;
  const permalinkDisabledReason = !data.exists
    ? 'Save this file first to generate a permalink.'
    : isDirty
      ? 'Save your changes first - permalinks need to match the saved file.'
      : undefined;
  // The Supplement filename isn't mechanically derivable (see the comment on
  // SUPPLEMENT_TEMPLATE_BODY above) - only the server knows it, via the
  // already-fetched absolute `data.path`.
  const relativePath = data.path
    ? `specifications/${dirName}/${versionDir}/Diagrams/${data.path.split(/[\\/]/).pop()}`
    : null;

  const SaveRow = ({ cardKey, label }) => (
    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
      <button type="button" className="save" onClick={() => save(cardKey)} disabled={saving}>
        {saving && activeCard === cardKey ? 'Saving...' : label || 'Save'}
      </button>
      {activeCard === cardKey && result?.ok && <span className="hint" style={{ color: 'var(--ok)' }}>Saved.</span>}
      {activeCard === cardKey && result?.error && <span className="hint" style={{ color: 'var(--danger)' }}>{result.error}</span>}
    </div>
  );

  return (
    <div className="panel panel-white">
      <h3 style={{ marginTop: 0 }}>Document History <span className="hint">{data.path}{data.justCreated ? ' — file just created from the standard template' : ''}</span></h3>
      <p className="hint">
        The hand-maintained tail of this component's specification (Jira references, further resources, and
        the administrative appendix). Chapter headings and table column headers are shown for context but
        can't be edited here; version/release history entries lock once superseded by newer ones, and only
        the acknowledgements table stays fully open.
      </p>

      <div className="card-list">
        <div className="card">
          <label>Document identity <span className="hint">from componentMetadata in the YAML — not editable here</span></label>
          <div className="row">
            <div className="field">
              <label>Name</label>
              <input type="text" value={data.meta?.name || ''} disabled />
            </div>
            <div className="field">
              <label>Version</label>
              <input type="text" value={data.meta?.version || ''} disabled />
            </div>
          </div>
        </div>

        <div className="card">
          <label>{data.jiraHeading}</label>
          <textarea
            value={data.jiraBody}
            onChange={(e) => setData({ ...data, jiraBody: e.target.value })}
            style={{ minHeight: 160 }}
          />
          <SaveRow cardKey="jira" label="Save Jira references" />
        </div>

        <div className="card">
          <label>{data.furtherHeading}</label>
          <textarea
            value={data.furtherBody}
            onChange={(e) => setData({ ...data, furtherBody: e.target.value })}
            style={{ minHeight: 100 }}
          />
          <SaveRow cardKey="further" label="Save further resources" />
        </div>

        <div className="card">
          <label>{data.docHistoryHeading} &ndash; {data.versionHistoryHeading}</label>
          <p className="hint">Only the most recent {EDITABLE_HISTORY_ROWS} entries can be edited or removed; earlier entries are locked.</p>
          <HistoryTable
            columns={data.versionHistory.columns}
            rows={data.versionHistory.rows}
            editableCount={EDITABLE_HISTORY_ROWS}
            onChange={(rows) => setData({ ...data, versionHistory: { ...data.versionHistory, rows } })}
          />
          <SaveRow cardKey="versionHistory" label="Save version history" />
        </div>

        <div className="card">
          <label>{data.docHistoryHeading} &ndash; {data.releaseHistoryHeading}</label>
          <p className="hint">Only the most recent {EDITABLE_HISTORY_ROWS} entries can be edited or removed; earlier entries are locked.</p>
          <HistoryTable
            columns={data.releaseHistory.columns}
            rows={data.releaseHistory.rows}
            editableCount={EDITABLE_HISTORY_ROWS}
            onChange={(rows) => setData({ ...data, releaseHistory: { ...data.releaseHistory, rows } })}
          />
          <SaveRow cardKey="releaseHistory" label="Save release history" />
        </div>

        <div className="card">
          <label>{data.acknowledgementsHeading}</label>
          <p className="hint">{data.ackIntro}</p>
          <HistoryTable
            columns={data.acknowledgements.columns}
            rows={data.acknowledgements.rows}
            editableCount={Infinity}
            onChange={(rows) => setData({ ...data, acknowledgements: { ...data.acknowledgements, rows } })}
          />
          <SaveRow cardKey="acknowledgements" label="Save acknowledgements" />
        </div>
      </div>

      <HighlightablePane
        title="Supplement"
        text={previewText}
        dirName={dirName}
        versionDir={versionDir}
        relativePath={relativePath}
        canPermalink={canPermalink}
        permalinkDisabledReason={permalinkDisabledReason}
        repoInfo={repoInfo}
        step={step}
        paneKey="supplement"
        initialSelection={pendingSelection}
        initialSelectionPane={pendingSelectionPane}
        onInitialSelectionApplied={onInitialSelectionApplied}
        onAddToIssueDraft={onAddToIssueDraft}
        inline
      />
    </div>
  );
}
