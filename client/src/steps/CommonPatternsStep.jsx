import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

// Mirrors the server's compareVersions (server/index.js) so a pre-v26.0 SID
// version can be flagged in the browser - see MIN_SID_VERSION below.
function compareVersions(a, b) {
  const toParts = (v) => v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = toParts(a);
  const pb = toParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// The SID reference framework was overhauled in v26.0 - every link recorded
// in docs/Common_Links/ has already been confirmed to resolve identically in
// sid_v26.0.json (see each file's "Version note"). Older versions are still
// valid (a component's own history may genuinely predate v26.0), so this is
// a warning threshold, not a hard floor - it flags a cell for a second look
// rather than blocking the save.
const MIN_SID_VERSION = 'v26.0';

function oldSidVersionsIn(value) {
  const tokens = (value || '').match(/\bv\d+(?:\.\d+)*\b/gi) || [];
  return tokens.filter((t) => compareVersions(t, MIN_SID_VERSION) < 0);
}

// A field can be a plain text input, or (kind: 'select') a dropdown
// constrained to `options` - used for "Depicted under component" so it can
// only be set to a component that actually exists in the repo. A row saved
// before that constraint existed (or before a component was renamed) may
// hold a value not in the current options - rather than silently dropping
// it, it's kept as the selected option (flagged red, "not in repo") so it
// stays visible and editable instead of disappearing.
function FieldInput({ field, value, onChange }) {
  if (field.kind === 'select') {
    const isUnmatched = value && !field.options.includes(value);
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={isUnmatched ? { color: 'var(--danger)' } : undefined}>
        <option value="">Select a component...</option>
        {isUnmatched && <option value={value} style={{ color: 'var(--danger)' }}>{value} (not in repo)</option>}
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.kind === 'sidPath') {
    return <SidElementField value={value} onChange={onChange} />;
  }
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />;
}

function toToken(text) {
  return (text || '').trim().replace(/\s+/g, '_');
}

// Every domain|ABE|[child|]version path the SID catalog can produce for one
// version, flattened once so a saved value can be matched back to the
// {domain, abe, childKey} triple that produced it (to pre-select the
// cascading picker below) - mirrors the line-building logic in
// SidPicker.jsx, just run over the whole catalog instead of one choice.
function buildSidPaths(catalog, version) {
  const paths = [];
  for (const domain of catalog.domains || []) {
    const domainToken = toToken(domain);
    for (const abe of catalog.abesByDomain[domain] || []) {
      const abeToken = toToken(abe);
      paths.push({ line: `${domainToken}|${abeToken}|${version}`, domain, abe, childKey: '' });
      for (const child of catalog.besByDomainAbe[`${domain}||${abe}`] || []) {
        const childKey = `${child.kind}:${child.name}`;
        const childToken = child.kind === 'BE' ? `${child.name}_BE` : toToken(child.name);
        paths.push({ line: `${domainToken}|${abeToken}|${childToken}|${version}`, domain, abe, childKey });
      }
    }
  }
  return paths;
}

// Cascading Domain -> ABE -> optional third segment picker for a single SID
// path value (as opposed to SidPicker.jsx, which manages a whole array of
// them for the Metadata tab). A flat dropdown isn't practical here - the SID
// catalog has on the order of 2,000 domain/ABE/BE combinations - so this
// narrows the choice down the same way SidPicker does. If the saved value
// doesn't match any path in the loaded version's catalog (an old version,
// or hand-typed drift), it's shown flagged rather than silently replaced -
// the selects stay blank until a real selection overwrites it.
function SidElementField({ value, onChange }) {
  const [versions, setVersions] = useState([]);
  const [version, setVersion] = useState('');
  const [catalog, setCatalog] = useState({ domains: [], abesByDomain: {}, besByDomainAbe: {} });
  const [domain, setDomain] = useState('');
  const [abe, setAbe] = useState('');
  const [childKey, setChildKey] = useState('');

  useEffect(() => {
    api.frameworkVersions('sid').then((r) => {
      setVersions(r.versions || []);
      setVersion((v) => v || r.versions?.[r.versions.length - 1] || '');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!version) return;
    api.frameworkCatalog('sid', version)
      .then(setCatalog)
      .catch(() => setCatalog({ domains: [], abesByDomain: {}, besByDomainAbe: {} }));
  }, [version]);

  const allPaths = useMemo(() => buildSidPaths(catalog, version), [catalog, version]);

  // Re-sync the selects to whatever the current value resolves to whenever
  // the catalog (re)loads - not on every keystroke elsewhere in the row -
  // so opening a row that already has a value shows the picker already
  // pointed at it instead of starting blank.
  useEffect(() => {
    const match = allPaths.find((p) => p.line === value);
    setDomain(match?.domain || '');
    setAbe(match?.abe || '');
    setChildKey(match?.childKey || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPaths]);

  const abeOptions = domain ? (catalog.abesByDomain[domain] || []) : [];
  const children = (domain && abe) ? (catalog.besByDomainAbe[`${domain}||${abe}`] || []) : [];
  const isUnmatched = value && !allPaths.some((p) => p.line === value);

  const applySelection = (nextDomain, nextAbe, nextChildKey) => {
    if (!nextDomain || !nextAbe) return;
    const domainToken = toToken(nextDomain);
    const abeToken = toToken(nextAbe);
    let childToken = '';
    if (nextChildKey) {
      const child = (catalog.besByDomainAbe[`${nextDomain}||${nextAbe}`] || []).find((c) => `${c.kind}:${c.name}` === nextChildKey);
      if (child) childToken = child.kind === 'BE' ? `${child.name}_BE` : toToken(child.name);
    }
    onChange(childToken ? `${domainToken}|${abeToken}|${childToken}|${version}` : `${domainToken}|${abeToken}|${version}`);
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <select
          value={version}
          onChange={(e) => { setVersion(e.target.value); setDomain(''); setAbe(''); setChildKey(''); }}
          style={{ flex: 0.6 }}
        >
          {versions.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select
          value={domain}
          onChange={(e) => { setDomain(e.target.value); setAbe(''); setChildKey(''); }}
        >
          <option value="">Domain...</option>
          {catalog.domains.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={abe}
          onChange={(e) => { setAbe(e.target.value); setChildKey(''); applySelection(domain, e.target.value, ''); }}
          disabled={!domain}
        >
          <option value="">ABE...</option>
          {abeOptions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={childKey}
          onChange={(e) => { setChildKey(e.target.value); applySelection(domain, abe, e.target.value); }}
          disabled={!abe}
        >
          <option value="">(no third segment)</option>
          {children.map((c) => (
            <option key={`${c.kind}:${c.name}`} value={`${c.kind}:${c.name}`}>
              {c.name} ({c.kind === 'BE' ? 'Business Entity' : 'sub-ABE'})
            </option>
          ))}
        </select>
      </div>
      {isUnmatched && (
        <p className="hint" style={{ color: 'var(--danger)' }}>
          Current value <code>{value}</code> doesn&rsquo;t match any path in the {version} catalog.
        </p>
      )}
    </div>
  );
}

// One editable link table backing a docs/Common_Links/*.md file. Modeled on
// LinksStep.jsx's LinksPanel, but these files aren't scoped to a single
// component (no dirName), so there's no "available once saved" gate. Every
// field flagged in versionFields is checked against MIN_SID_VERSION, but
// unlike an unresolved duplicate pair, an old SID version is only a warning -
// pre-v26.0 references are real and expected in older components' history,
// so they're flagged, not blocked from saving.
function CommonLinksPanel({ title, helpText, fields, blankRow, pairKeyFn, versionFields, arrowAfter, getApi, saveApi }) {
  const [data, setData] = useState(null); // { exists, heading, notesBefore, notesAfter, links }
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { ok, error? }
  const [activeRow, setActiveRow] = useState(null);

  useEffect(() => {
    setData(null);
    setResult(null);
    getApi().then((d) => setData(d)).catch((err) => setResult({ ok: false, error: err.message }));
  }, []);

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

  const rowVersionIssues = data.links.map((row) => (versionFields || [])
    .map((f) => ({ field: f, tokens: oldSidVersionsIn(row[f]) }))
    .filter((issue) => issue.tokens.length > 0));

  const save = async (rowIndex) => {
    if (duplicateRows.size > 0) return;
    setActiveRow(rowIndex ?? null);
    setSaving(true);
    setResult(null);
    try {
      const res = await saveApi({
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
      <h3 style={{ marginTop: 0 }}>{title} <span className="hint">{data.heading}</span></h3>
      <p className="hint">{helpText}</p>

      <div className="card-list">
        {data.links.map((row, i) => {
          const isDuplicate = duplicateRows.has(i);
          const versionIssues = rowVersionIssues[i];
          const hasVersionWarning = versionIssues.length > 0;
          const isActive = activeRow === i;
          const borderColor = isDuplicate ? 'var(--danger)' : (hasVersionWarning ? 'var(--help)' : null);
          return (
            <div className="card" key={i} style={{ paddingTop: 14, ...(borderColor ? { borderColor } : null) }}>
              {isDuplicate && (
                <p className="hint" style={{ color: 'var(--danger)' }}>
                  This pair is already captured by another row - each relationship should appear once.
                </p>
              )}
              {versionIssues.map((issue) => (
                <p className="hint" style={{ color: 'var(--help)' }} key={issue.field}>
                  Warning: {fields.find((f) => f.key === issue.field)?.label || issue.field} references {issue.tokens.join(', ')} &mdash; earlier than {MIN_SID_VERSION}.
                </p>
              ))}
              <div className="row">
                {fields.map((f) => (
                  <React.Fragment key={f.key}>
                    <div className="field">
                      <label>{f.label}</label>
                      <FieldInput field={f} value={row[f.key]} onChange={(v) => updateRow(i, f.key, v)} />
                    </div>
                    {arrowAfter?.includes(f.key) && (
                      <span style={{ alignSelf: 'flex-end', marginBottom: 22, fontSize: '1.1rem', color: 'var(--muted)' }}>&rarr;</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="button" className="save" onClick={() => save(i)} disabled={saving || isDuplicate}>
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

// Editor for docs/Common_Links/Common_Component_SID_owner_Links.md - which
// component box a SID ABE is drawn under when it isn't its own. Rows can
// legitimately repeat the same component/SID pair (see the file's own
// notes), so no pairKeyFn/duplicate check is applied here.
export function CommonComponentSidOwnerStep() {
  const [componentOptions, setComponentOptions] = useState([]);

  useEffect(() => {
    api.components().then((r) => setComponentOptions(r.components.map((c) => `${c.id} - ${c.name}`))).catch(() => {});
  }, []);

  return (
    <CommonLinksPanel
      title={<>Common Component&ndash;SID owner links</>}
      helpText="Consolidated cross-component 'which component box does this SID ABE sit under' links, across all components. Backs docs/Common_Links/Common_Component_SID_owner_Links.md."
      getApi={api.commonComponentSidOwnerLinks}
      saveApi={api.saveCommonComponentSidOwnerLinks}
      blankRow={{ component: '', sidElement: '' }}
      versionFields={['sidElement']}
      fields={[
        { key: 'component', label: 'Depicted under component', kind: 'select', options: componentOptions },
        { key: 'sidElement', label: 'SID element as present in the YAML file', kind: 'sidPath' },
      ]}
    />
  );
}
