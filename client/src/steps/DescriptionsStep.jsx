import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function FieldInput({ field, value, onChange }) {
  if (field.kind === 'select') {
    const hasValue = !value || field.options.some((o) => o.value === value);
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose...</option>
        {!hasValue && <option value={value}>{value} — not in the current eTOMs/Functional Framework Functions selection</option>}
        {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (field.kind === 'textarea') {
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />;
}

// One editable description table backing a Diagrams/<ID>_<suffix>.md file -
// each row is keyed by a single identifier (an eTOM activity ID or a
// Functional Framework function ID) by default, unlike the Links tab's
// two-sided pairing, so duplicate detection here is just "this identifier
// already has a row" rather than a pair key. SID descriptions are the
// exception: "SID ABE Level 1" alone legitimately repeats once per Level 2
// child (see TMFC002_SID_Descriptions.md's two "Customer Product Order"
// rows), so that panel passes a dupKeyFn combining both levels instead of
// relying on the fields[0] default.
function DescriptionsPanel({ dirName, title, helpText, fields, blankRow, getApi, saveApi, dupKeyFn }) {
  const [data, setData] = useState(null); // { exists, heading, notesBefore, notesAfter, links }
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { ok, error? }
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
      // No file yet for this component - create an empty one on disk right
      // away, matching the Links tab's behavior, so every opened component
      // has a file in its Diagrams/ folder ready to fill in (or leave empty).
      saveApi(dirName, { heading: d.heading, notesBefore: '', notesAfter: '', links: [] })
        .then(() => setData({ ...d, exists: true, justCreated: true }))
        .catch((err) => {
          setData(d);
          setResult({ ok: false, error: `Could not auto-create the file: ${err.message}` });
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

  const rows = data.links; // server field is generically named "links" - reused as-is for description rows
  const keyFn = dupKeyFn || ((row) => row[fields[0].key]);

  const updateRow = (i, field, value) => {
    const next = rows.slice();
    next[i] = { ...next[i], [field]: value };
    setData({ ...data, links: next });
  };
  const addRow = () => setData({ ...data, links: [...rows, { ...blankRow }] });
  const removeRow = (i) => setData({ ...data, links: rows.filter((_, idx) => idx !== i) });

  const idCounts = {};
  rows.forEach((r) => {
    const v = (keyFn(r) || '').trim();
    if (v) idCounts[v] = (idCounts[v] || 0) + 1;
  });
  const isDuplicateRow = (row) => {
    const v = (keyFn(row) || '').trim();
    return Boolean(v) && idCounts[v] > 1;
  };
  const hasDuplicates = rows.some(isDuplicateRow);

  const save = async (rowIndex) => {
    if (hasDuplicates) return;
    setActiveRow(rowIndex ?? null);
    setSaving(true);
    setResult(null);
    try {
      const res = await saveApi(dirName, {
        heading: data.heading,
        notesBefore: data.notesBefore,
        notesAfter: data.notesAfter,
        links: rows,
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

      <div className="field">
        <label>Source / notes <span className="hint">e.g. which published document this was transcribed from, or "confirmed empty" if this component has none</span></label>
        <textarea value={data.notesBefore} onChange={(e) => setData({ ...data, notesBefore: e.target.value })} />
      </div>

      <div className="card-list">
        {rows.map((row, i) => {
          const isDuplicate = isDuplicateRow(row);
          const isActive = activeRow === i;
          return (
            <div className="card" key={i} style={{ paddingTop: 14, ...(isDuplicate ? { borderColor: 'var(--danger)' } : null) }}>
              {isDuplicate && (
                <p className="hint" style={{ color: 'var(--danger)' }}>
                  This entry is already captured by another row above - each entry should appear once.
                </p>
              )}
              {fields.map((f) => (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <FieldInput field={f} value={row[f.key]} onChange={(v) => updateRow(i, f.key, v)} />
                </div>
              ))}
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="button" className="save" onClick={() => save(i)} disabled={saving || hasDuplicates}>
                  {saving && isActive ? 'Saving...' : 'Save'}
                </button>
                {isActive && result?.ok && <span className="hint" style={{ color: 'var(--ok)' }}>Saved.</span>}
                {isActive && result?.error && <span className="hint" style={{ color: 'var(--danger)' }}>{result.error}</span>}
                {isDuplicate && <span className="hint" style={{ color: 'var(--danger)' }}>Resolve the duplicate entry above to save.</span>}
                <button type="button" className="remove" onClick={() => removeRow(i)} style={{ marginLeft: 'auto' }}>Remove</button>
              </div>
            </div>
          );
        })}
        <button type="button" className="save" onClick={addRow}>+ Add row</button>
        {rows.length === 0 && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="save" onClick={() => save(null)} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            <span className="hint">No rows yet.</span>
            {activeRow === null && result?.ok && <span className="hint" style={{ color: 'var(--ok)' }}>Saved.</span>}
            {activeRow === null && result?.error && <span className="hint" style={{ color: 'var(--danger)' }}>{result.error}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// Parses a componentMetadata list entry ("id|token[|token...]|version") into
// {value, label} for the Identifier/Function ID picker - id is always the
// first segment and version the last, matching every eTOM/Functional
// Framework entry shape (see the component-specification-markdown skill's
// references/diagrams.md); the display label folds whatever's left in
// between into one space-separated name.
function idOptionsFrom(entries) {
  return (entries || []).map((line) => {
    const parts = line.split('|');
    const id = parts[0];
    const name = parts.slice(1, -1).join(' ').replace(/_/g, ' ');
    return { value: id, label: name ? `${id} — ${name}` : id };
  });
}

// Editor for the three hand-maintained lookup tables under
// specifications/<dirName>/Diagrams/ that hold descriptive prose the YAML
// has no room for: each eTOM activity's own business description (section
// 2.1), each Functional Framework function's own description plus its two
// Aggregate Function Level columns (section 2.4) - both also carrying
// Version/Document Name/Alignment Notes provenance columns recording which
// framework release a row was transcribed at, its name in the source
// document, and whether that still matches the component's YAML - and each
// SID ABE's own Level 1/Level 2 definitions plus its original Source column
// (section 2.2) - real examples: TMFC005_eTOM_Descriptions.md,
// TMFC005_FF_Descriptions.md, TMFC002_SID_Descriptions.md. Only meaningful
// once a component directory exists on disk, so this is hidden while
// creating a brand-new (not yet saved) component.
export default function DescriptionsStep({ dirName, eTOMs, functionalFrameworkFunctions }) {
  if (!dirName) {
    return (
      <div className="panel panel-white">
        <h3 style={{ marginTop: 0 }}>Descriptions</h3>
        <p className="hint">Available once this component has been saved at least once.</p>
      </div>
    );
  }

  const etomOptions = idOptionsFrom(eTOMs);
  const ffOptions = idOptionsFrom(functionalFrameworkFunctions);

  return (
    <>
      <DescriptionsPanel
        dirName={dirName}
        title="eTOM business activity descriptions"
        helpText="Section 2.1 - each eTOM activity's own descriptive text. This prose lives in the eTOM standard itself, not this component's YAML, so it's transcribed here once from the component's published document."
        getApi={api.componentEtomDescriptions}
        saveApi={api.saveComponentEtomDescriptions}
        blankRow={{ identifier: '', description: '', version: '', documentName: '', alignmentNotes: '' }}
        fields={[
          { key: 'identifier', label: 'Identifier', kind: 'select', options: etomOptions },
          { key: 'description', label: 'Description', kind: 'textarea' },
          { key: 'version', label: 'Version', kind: 'text' },
          { key: 'documentName', label: 'Document Name', kind: 'text' },
          { key: 'alignmentNotes', label: 'Alignment Notes', kind: 'text' },
        ]}
      />

      <DescriptionsPanel
        dirName={dirName}
        title="Functional Framework function descriptions"
        helpText="Section 2.4 - each Functional Framework function's own descriptive text and Aggregate Function Level columns, transcribed from the component's published document."
        getApi={api.componentFFDescriptions}
        saveApi={api.saveComponentFFDescriptions}
        blankRow={{ functionId: '', functionDescription: '', aggregateLevel1: '', aggregateLevel2: '', version: '', documentName: '', alignmentNotes: '' }}
        fields={[
          { key: 'functionId', label: 'Function ID', kind: 'select', options: ffOptions },
          { key: 'functionDescription', label: 'Function Description', kind: 'textarea' },
          { key: 'aggregateLevel1', label: 'Aggregate Function Level 1', kind: 'text' },
          { key: 'aggregateLevel2', label: 'Aggregate Function Level 2', kind: 'text' },
          { key: 'version', label: 'Version', kind: 'text' },
          { key: 'documentName', label: 'Document Name', kind: 'text' },
          { key: 'alignmentNotes', label: 'Alignment Notes', kind: 'text' },
        ]}
      />

      <DescriptionsPanel
        dirName={dirName}
        title="SID descriptions"
        helpText="Section 2.2 - each SID ABE's own Level 1/Level 2 definitions, transcribed from the component's published document. A Level 1 ABE with multiple Level 2 entities gets one row per entity, so duplicates are only flagged when both levels match another row."
        getApi={api.componentSidDescriptions}
        saveApi={api.saveComponentSidDescriptions}
        blankRow={{ sidAbeLevel1: '', sidAbeLevel1Definition: '', sidAbeLevel2: '', sidAbeLevel2Definition: '', source: '' }}
        dupKeyFn={(row) => `${(row.sidAbeLevel1 || '').trim().toLowerCase()}||${(row.sidAbeLevel2 || '').trim().toLowerCase()}`}
        fields={[
          { key: 'sidAbeLevel1', label: 'SID ABE Level 1', kind: 'text' },
          { key: 'sidAbeLevel1Definition', label: 'SID ABE L1 Definition', kind: 'textarea' },
          { key: 'sidAbeLevel2', label: 'SID ABE Level 2', kind: 'text' },
          { key: 'sidAbeLevel2Definition', label: 'SID ABE L2 Definition', kind: 'textarea' },
          { key: 'source', label: 'Source', kind: 'text' },
        ]}
      />
    </>
  );
}
