import React from 'react';
import TaxonomyPicker from './TaxonomyPicker.jsx';
import SidPicker from './SidPicker.jsx';

function ContactList({ label, items, onChange }) {
  const update = (i, field, value) => {
    const next = items.slice();
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };
  const add = () => onChange([...items, { name: '', email: '', url: '' }]);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="field">
      <label>{label} <span className="hint">optional</span></label>
      <div className="card-list">
        {items.map((item, i) => (
          <div className="card" key={i}>
            <button type="button" className="card-remove remove" onClick={() => remove(i)}>Remove</button>
            <div className="row">
              <div className="field">
                <label>Name</label>
                <input type="text" value={item.name} onChange={(e) => update(i, 'name', e.target.value)} />
              </div>
              <div className="field">
                <label>Email</label>
                <input type="text" value={item.email} onChange={(e) => update(i, 'email', e.target.value)} />
              </div>
              <div className="field">
                <label>URL</label>
                <input type="text" value={item.url} onChange={(e) => update(i, 'url', e.target.value)} />
              </div>
            </div>
          </div>
        ))}
        <button type="button" className="save" onClick={add}>+ Add {label.slice(0, -1)}</button>
      </div>
    </div>
  );
}

// componentMetadata.status values - same list as STATUS_VALUES in
// server/specRules.js, which rejects anything else on save.
const STATUS_VALUES = ['backlog', 'roadmap', 'preview', 'production', 'not released'];

export default function MetadataStep({ state, setState, functionalBlocks, locked }) {
  const set = (field) => (e) => setState({ ...state, [field]: e.target.value });
  // The name is half of the folder and file names, which only allow letters
  // and digits (TMFCnnn-Name) - see NAME_PATTERNS in server/specRules.js.
  const nameInvalid = !locked && state.name !== '' && !/^[A-Za-z0-9]+$/.test(state.name);
  const versionInvalid = !locked && !/^\d+\.\d+\.\d+$/.test(state.version);

  return (
    <div className="panel">
      <div className="row">
        <div className="field">
          <label>Component ID <span className="hint">{locked ? 'locked while editing' : 'next free ID across all branches - not editable'}</span></label>
          <input type="text" value={state.id} placeholder="Looking up the next free ID…" disabled />
        </div>
        <div className="field">
          <label>Name <span className="hint">{locked ? 'locked while editing' : 'letters and digits only, e.g. ProductInventory'}</span></label>
          <input type="text" value={state.name} onChange={set('name')} placeholder="MyNewComponent" disabled={locked} />
          {nameInvalid && <span className="hint" style={{ color: 'var(--danger)' }}>Use letters and digits only - no spaces or punctuation.</span>}
        </div>
      </div>

      <div className="field">
        <label>Description</label>
        <textarea value={state.description} onChange={set('description')} placeholder="What this component is responsible for..." />
      </div>

      <div className="row">
        <div className="field">
          <label>Version <span className="hint">{locked ? 'set on save by the version rule' : 'X.Y.Z, usually 1.0.0'}</span></label>
          <input type="text" value={state.version} onChange={set('version')} placeholder="1.0.0" disabled={locked} />
          {versionInvalid && <span className="hint" style={{ color: 'var(--danger)' }}>Use X.Y.Z, e.g. 1.0.0.</span>}
        </div>
        <div className="field">
          <label>Status <span className="hint">not editable</span></label>
          <select value={state.status} disabled>
            {STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
            {!STATUS_VALUES.includes(state.status) && <option value={state.status}>{state.status} (not allowed)</option>}
          </select>
        </div>
        <div className="field">
          <label>Publication date</label>
          <input type="date" value={state.publicationDate} onChange={set('publicationDate')} />
        </div>
      </div>

      <div className="field">
        <label>Functional block</label>
        <input
          type="text"
          list="functional-block-options"
          value={state.functionalBlock}
          onChange={set('functionalBlock')}
          placeholder="e.g. CoreCommerce"
        />
        <datalist id="functional-block-options">
          {functionalBlocks.map((fb) => <option key={fb} value={fb} />)}
        </datalist>
      </div>

      <ContactList label="Owners" items={state.owners} onChange={(v) => setState({ ...state, owners: v })} />
      <ContactList label="Maintainers" items={state.maintainers} onChange={(v) => setState({ ...state, maintainers: v })} />

      <TaxonomyPicker
        title="eTOMs"
        hint="Business Process Framework"
        kind="etom"
        value={state.eTOMs}
        onChange={(v) => setState({ ...state, eTOMs: v })}
      />
      <TaxonomyPicker
        title="Functional Framework Functions"
        hint="Functional Framework"
        kind="functional-framework"
        value={state.functionalFrameworkFunctions}
        onChange={(v) => setState({ ...state, functionalFrameworkFunctions: v })}
      />
      <SidPicker
        value={state.SIDs}
        onChange={(v) => setState({ ...state, SIDs: v })}
      />
    </div>
  );
}
