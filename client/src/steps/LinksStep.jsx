import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const ETOM_SID_DIRECTIONS = ['bidirectional', 'activity consumes', 'activity produces'];

// The YAML eTOM/YAML SID (and similar cross-reference) cells can reference
// more than one entry (e.g. a link driven by two related eTOM activities),
// joined with "; " in the stored markdown - see TMFC005's "Loyalty Program
// Management / Loyalty Program Operation" row for a real example.
function parseMulti(str) {
  return (str || '').split(';').map((s) => s.trim()).filter(Boolean);
}

// Constrains a YAML cross-reference cell to entries already chosen in this
// component's eTOMs/SIDs pickers (on the Metadata tab), instead of free
// text - those are the only values that can validly appear here, so typing
// them by hand only invites typos and drift from the pickers. The
// underlying value still supports multiple "; "-joined entries (see
// parseMulti above), but the picker itself only ever shows one at a time:
// once a value is chosen, the dropdown/Add control is replaced by just that
// value and its Remove button, and picking is only offered again once it's
// removed. A previously-stored value that isn't in the current options
// still shows, flagged, and can be removed individually - this is also how
// a hand-transcribed "external (cross-component)" reference (real examples:
// TMFC035's SID-SID links) survives even though this picker can't add one.
function MultiSelectField({ label, hint, options, valueString, onChange }) {
  const selected = parseMulti(valueString);
  const available = options.filter((o) => !selected.includes(o));
  const [pending, setPending] = useState('');

  const add = () => {
    if (!pending) return;
    onChange([...selected, pending].join('; '));
    setPending('');
  };
  const remove = (v) => onChange(selected.filter((s) => s !== v).join('; '));

  return (
    <div className="field">
      <label>{label} <span className="hint">{hint}</span></label>
      {selected.length === 0 && available.length > 0 && (
        <div className="row" style={{ marginBottom: 6 }}>
          <select
            value={pending}
            onChange={(e) => setPending(e.target.value)}
            style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}
          >
            <option value="">Choose one to add...</option>
            {available.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <button type="button" className="save" onClick={add} disabled={!pending}>+ Add</button>
        </div>
      )}
      {selected.length === 0 && options.length === 0 && (
        <p className="hint">Nothing selected on the Metadata tab yet.</p>
      )}
      {selected.length > 0 ? (
        <div className="card-list">
          {selected.map((v) => {
            const isUnmatched = !options.includes(v);
            return (
              <div key={v} className="row" style={{ alignItems: 'center' }}>
                <span style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem', color: isUnmatched ? 'var(--danger)' : 'inherit' }}>
                  {v}{isUnmatched ? ' — not in current selection above' : ''}
                </span>
                <button type="button" className="remove" onClick={() => remove(v)}>Remove</button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hint">None selected.</p>
      )}
    </div>
  );
}

function FieldInput({ field, value, onChange }) {
  if (field.kind === 'select') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.kind === 'multiselect') {
    return (
      <MultiSelectField
        label={field.label}
        hint={field.hint}
        options={field.options}
        valueString={value}
        onChange={onChange}
      />
    );
  }
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />;
}

// One editable link table backing a Diagrams/<ID>_<suffix>.md file - the
// eTOM-SID link table, with a constrained Direction dropdown instead of
// free text.
function LinksPanel({ dirName, title, helpText, fields, blankRow, pairKeyFn, getApi, saveApi }) {
  const [data, setData] = useState(null); // { exists, heading, notesBefore, notesAfter, links }
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { ok, error? }
  // Which card's Save button triggered the in-flight/last save, so the
  // Saving.../Saved/error feedback shows right on that card - there's one
  // file (and one save call) for the whole component, but each card gets
  // its own visible Save button and its own feedback next to it.
  const [activeRow, setActiveRow] = useState(null);

  useEffect(() => {
    setData(null);
    setResult(null);
    if (!dirName) return;
    getApi(dirName).then((d) => {
      if (d.exists) {
        setData({ ...d, justCreated: false });
        return;
      }
      // No links file yet for this component - create an empty one on disk
      // right away instead of only writing one the first time "Save links"
      // is clicked, so every component that's been opened here has a file
      // in its Diagrams/ folder ready to fill in (or leave empty).
      saveApi(dirName, { heading: d.heading, notesBefore: '', notesAfter: '', links: [] })
        .then(() => setData({ ...d, exists: true, justCreated: true }))
        .catch((err) => {
          setData(d);
          setResult({ ok: false, error: `Could not auto-create the links file: ${err.message}` });
        });
    }).catch((err) => setResult({ ok: false, error: err.message }));
  }, [dirName]);

  if (!dirName) {
    return (
      <div className="panel panel-white">
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p className="hint">Available once this component has been saved at least once.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="panel panel-white">
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <div className="hint">Loading...</div>
      </div>
    );
  }

  const updateRow = (i, field, value) => {
    const links = data.links.slice();
    links[i] = { ...links[i], [field]: value };
    setData({ ...data, links });
  };
  const addRow = () => setData({ ...data, links: [...data.links, { ...blankRow }] });
  const removeRow = (i) => setData({ ...data, links: data.links.filter((_, idx) => idx !== i) });

  const pairKeys = pairKeyFn ? data.links.map(pairKeyFn) : [];
  const duplicateRows = new Set();
  pairKeys.forEach((k, i) => {
    if (k === null) return;
    const firstIdx = pairKeys.indexOf(k);
    if (firstIdx !== i) { duplicateRows.add(i); duplicateRows.add(firstIdx); }
  });

  const save = async (rowIndex) => {
    if (duplicateRows.size > 0) return;
    setActiveRow(rowIndex ?? null);
    setSaving(true);
    setResult(null);
    try {
      const res = await saveApi(dirName, {
        heading: data.heading,
        notesBefore: data.notesBefore,
        notesAfter: data.notesAfter,
        links: data.links,
      });
      if (res.ok) {
        setResult({ ok: true, path: res.path });
        setData({ ...data, exists: true });
      } else {
        setResult({ ok: false, error: res.error || 'Save failed' });
      }
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel panel-white">
      <h3 style={{ marginTop: 0 }}>{title} <span className="hint">{data.heading}{data.justCreated ? ' — file just created' : ''}</span></h3>
      <p className="hint">{helpText}</p>

      <div className="card-list">
        {data.links.map((row, i) => {
          const isDuplicate = duplicateRows.has(i);
          const isActive = activeRow === i;
          return (
            <div className="card" key={i} style={{ paddingTop: 14, ...(isDuplicate ? { borderColor: 'var(--danger)' } : null) }}>
              {isDuplicate && (
                <p className="hint" style={{ color: 'var(--danger)' }}>
                  This pair is already captured by another row - each relationship should appear once.
                </p>
              )}
              {fields.filter((f) => f.kind !== 'multiselect').length > 0 && (
                <div className="row">
                  {fields.filter((f) => f.kind !== 'multiselect').map((f) => (
                    <div className="field" key={f.key}>
                      <label>{f.label}</label>
                      <FieldInput field={f} value={row[f.key]} onChange={(v) => updateRow(i, f.key, v)} />
                    </div>
                  ))}
                </div>
              )}
              {fields.filter((f) => f.kind === 'multiselect').map((f) => (
                <FieldInput key={f.key} field={f} value={row[f.key]} onChange={(v) => updateRow(i, f.key, v)} />
              ))}
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="button" className="save" onClick={() => save(i)} disabled={saving || duplicateRows.size > 0}>
                  {saving && isActive ? 'Saving...' : 'Save'}
                </button>
                {isActive && result?.ok && <span className="hint" style={{ color: 'var(--ok)' }}>Saved.</span>}
                {isActive && result?.error && <span className="hint" style={{ color: 'var(--danger)' }}>{result.error}</span>}
                {isDuplicate && <span className="hint" style={{ color: 'var(--danger)' }}>Resolve the duplicate pair above to save.</span>}
                <button type="button" className="remove" onClick={() => removeRow(i)} style={{ marginLeft: 'auto' }}>Remove</button>
              </div>
            </div>
          );
        })}
        <button type="button" className="save" onClick={addRow}>+ Add link</button>
        {data.links.length === 0 && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="save" onClick={() => save(null)} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            <span className="hint">No link rows yet.</span>
            {activeRow === null && result?.ok && <span className="hint" style={{ color: 'var(--ok)' }}>Saved.</span>}
            {activeRow === null && result?.error && <span className="hint" style={{ color: 'var(--danger)' }}>{result.error}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// The eTOM/SID pair a row actually connects - each side's own multi-value
// list is order-independent (picking the same two eTOMs in a different
// order is still the same relationship) and only meaningful once both sides
// are chosen, so a fresh blank row isn't flagged as a duplicate of every
// other blank row.
function unorderedPairKey(a, b) {
  const left = parseMulti(a).slice().sort().join(';');
  const right = parseMulti(b).slice().sort().join(';');
  if (!left || !right) return null;
  return `${left}||${right}`;
}

// Editor for the hand-maintained eTOM-SID link table under
// specifications/<dirName>/Diagrams/ - the eTOM-SID cross-links backing the
// "eTOM L2 - SID ABEs links" diagram. Only meaningful once a component
// directory exists on disk, so this is hidden while creating a brand-new
// (not yet saved) component.
export default function LinksStep({ dirName, eTOMs, SIDs }) {
  if (!dirName) {
    return (
      <div className="panel panel-white">
        <h3 style={{ marginTop: 0 }}>Links</h3>
        <p className="hint">Available once this component has been saved at least once.</p>
      </div>
    );
  }

  return (
    <LinksPanel
      dirName={dirName}
      title={<>eTOM&ndash;SID links</>}
      helpText="These links are to ensure that the SID eTOM links diagram is drawn correctly in the specification document, and do not form part of the specification as such."
      getApi={api.componentLinks}
      saveApi={api.saveComponentLinks}
      blankRow={{ etomActivity: '', sidABE: '', direction: 'bidirectional', yamlETOM: '', yamlSID: '' }}
      pairKeyFn={(row) => unorderedPairKey(row.yamlETOM, row.yamlSID)}
      fields={[
        { key: 'etomActivity', label: 'eTOM diagram display Label', kind: 'text' },
        { key: 'sidABE', label: 'SID diagram display label', kind: 'text' },
        { key: 'direction', label: 'Direction', kind: 'select', options: ETOM_SID_DIRECTIONS },
        { key: 'yamlETOM', label: 'YAML eTOM', kind: 'multiselect', options: eTOMs, hint: 'from the eTOMs picker on the Metadata tab' },
        { key: 'yamlSID', label: 'YAML SID', kind: 'multiselect', options: SIDs, hint: 'from the SIDs picker on the Metadata tab' },
      ]}
    />
  );
}
