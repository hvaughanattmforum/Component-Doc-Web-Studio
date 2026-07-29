import React, { useState } from 'react';
import ResourcePicker from './ResourcePicker.jsx';
import { matchCatalogEntry, isKnownApiId } from '../apiCatalogUtils.js';

function ResourceRows({ resources, onChange, canUsePicker, allCaptured }) {
  const update = (i, field, value) => {
    const next = resources.slice();
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };
  const add = () => onChange([...resources, { name: '', verbs: '' }]);
  const remove = (i) => onChange(resources.filter((_, idx) => idx !== i));

  return (
    <div className="field">
      <label>Resources <span className="hint">optional, e.g. productCatalog / GET, GET /id, POST</span></label>
      {resources.map((r, i) => (
        <div className="row" key={i} style={{ marginBottom: 6 }}>
          <div className="field">
            <input type="text" placeholder="resource name" value={r.name} onChange={(e) => update(i, 'name', e.target.value)} />
          </div>
          <div className="field">
            <input type="text" placeholder="GET, GET /id, POST, PATCH, DELETE" value={r.verbs} onChange={(e) => update(i, 'verbs', e.target.value)} />
          </div>
          <button type="button" className="remove" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      {/* Once the resource picker can run against a real swagger spec, manual
          free-text resource entry is only for removing rows, not adding new
          ones - the picker above is the authoritative way to add. */}
      {canUsePicker
        ? (
          <div className="hint">
            {allCaptured
              ? "All resources from this API's spec are already captured above - use the resource picker to edit their operations."
              : "Use the resource picker above to add this API's resources from its real spec."}
          </div>
        )
        : <button type="button" className="save" onClick={add}>+ Add resource</button>}
    </div>
  );
}

const LOCKED_MESSAGE = 'If this needs changing, please delete and start again.';

// One card per declared specification version. Each version manages its own
// resources independently - the same API can expose a different resource
// shape release to release (e.g. TMF620 v5's "productCatalog" was called
// "catalog" in v4), so resources picked for one version must never bleed
// into another.
function SpecVersionCard({ apiId, spec, onChange, onChangeFields, onRemove, apiCatalog, removable }) {
  // Only known once the picker's "Load resources" has been used at least
  // once - null until then, so there's no way yet to tell whether every real
  // resource has been captured.
  const [specResources, setSpecResources] = useState(null);
  const [versionLockHint, setVersionLockHint] = useState(false);

  const match = matchCatalogEntry(apiCatalog, (apiId || '').trim(), spec.version);

  const addResourceFromPicker = (name, verbs) => {
    const resources = spec.resources || [];
    const existingIdx = resources.findIndex((r) => r.name === name);
    const verbsText = verbs.join(', ');
    const next = existingIdx >= 0
      ? resources.map((r, idx) => (idx === existingIdx ? { ...r, verbs: verbsText } : r))
      : [...resources, { name, verbs: verbsText }];
    // matchCatalogEntry (see apiCatalogUtils.js) resolves a catalog entry
    // even with an empty apiVersion - it just falls back to the highest
    // version - so resources can get added before the Version field is ever
    // filled in. Since the version field locks read-only the moment any
    // resource exists (below), leaving it blank here would freeze it empty
    // permanently and silently drop `version` from the saved YAML. Backfill
    // it from whatever the picker actually resolved against, in one atomic
    // update alongside the resources themselves (a separate onChange call
    // for each would race against this component's own stale `spec` prop).
    const patch = { resources: next };
    if (!spec.version && match) patch.version = match.version;
    onChangeFields(patch);
  };

  const allCaptured = !!specResources?.length
    && specResources.every((r) => (spec.resources || []).some((er) => er.name === r.name));
  // Once a resource+operation selection has actually been saved against this
  // version, changing the version number would silently orphan it (the saved
  // resources stay tagged to a version number that no longer matches what's
  // on screen) - lock it and point at the real fix (delete and re-add).
  const versionLocked = (spec.resources || []).length > 0;

  return (
    <div className="card" style={{ background: 'var(--panel-alt, rgba(255,255,255,0.03))' }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <div className="field">
          <label>Version</label>
          <input
            type="text"
            value={spec.version}
            onChange={(e) => onChange('version', e.target.value)}
            placeholder="5"
            readOnly={versionLocked}
            className={versionLocked ? 'locked' : undefined}
            onClick={() => { if (versionLocked) setVersionLockHint(true); }}
            onBlur={() => setVersionLockHint(false)}
          />
        </div>
        {removable && <button type="button" className="ghost" onClick={onRemove}>Remove version</button>}
      </div>
      {versionLockHint && <div className="status-banner error" style={{ marginBottom: 10 }}>{LOCKED_MESSAGE}</div>}
      <ResourcePicker
        apiId={apiId}
        apiVersion={spec.version}
        apiCatalog={apiCatalog}
        existingResources={spec.resources}
        onAdd={addResourceFromPicker}
        onResourcesLoaded={setSpecResources}
      />
      <ResourceRows
        resources={spec.resources}
        onChange={(v) => onChange('resources', v)}
        canUsePicker={!!match}
        allCaptured={allCaptured}
      />
    </div>
  );
}

export default function ApiListStep({ title, items, onChange, apiCatalog, requiredMeaning }) {
  // Which card (by index) most recently had a locked ID/apiSDO field clicked
  // - drives showing the "delete and start again" hint next to that card
  // specifically, not every locked card at once.
  const [lockAttemptIdx, setLockAttemptIdx] = useState(null);

  const update = (i, field, value) => {
    const next = items.slice();
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };
  const add = () => onChange([...items, {
    id: '', apiSDO: 'tmForum', required: false, name: '', specifications: [{ version: '', resources: [], raw: {} }],
  }]);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));

  const updateSpec = (i, specIdx, field, value) => {
    const specs = items[i].specifications.slice();
    specs[specIdx] = { ...specs[specIdx], [field]: value };
    update(i, 'specifications', specs);
  };
  // Multi-field variant of updateSpec, for callers that need to change more
  // than one field atomically (e.g. resources + a version backfill together)
  // rather than as two separate state updates racing against each other.
  const updateSpecFields = (i, specIdx, patch) => {
    const specs = items[i].specifications.slice();
    specs[specIdx] = { ...specs[specIdx], ...patch };
    update(i, 'specifications', specs);
  };
  const addSpec = (i) => update(i, 'specifications', [...items[i].specifications, { version: '', resources: [], raw: {} }]);
  const removeSpec = (i, specIdx) => update(i, 'specifications', items[i].specifications.filter((_, idx) => idx !== specIdx));

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div className="card-list">
        {items.map((item, i) => {
          // Once any specification version under this API has a saved
          // resource/operation selection, its identity (id/apiSDO) is locked
          // - changing either out from under already-saved resources would
          // silently point them at the wrong API.
          const itemLocked = item.specifications.some((s) => (s.resources || []).length > 0);
          return (
            <div className="card" key={i}>
              <button type="button" className="card-remove remove" onClick={() => remove(i)}>Remove</button>
              <div className="row">
                <div className="field">
                  <label>API ID <span className="hint">Select an API ID to enable the resource picker</span></label>
                  <input
                    type="text"
                    list="api-catalog-options"
                    value={item.id}
                    onChange={(e) => update(i, 'id', e.target.value)}
                    placeholder="TMF620"
                    readOnly={itemLocked}
                    className={itemLocked ? 'locked' : (isKnownApiId(apiCatalog, item.id) ? undefined : 'unresolved')}
                    onClick={() => { if (itemLocked) setLockAttemptIdx(i); }}
                    onBlur={() => setLockAttemptIdx((cur) => (cur === i ? null : cur))}
                  />
                </div>
                <div className="field">
                  <label>apiSDO</label>
                  <input
                    type="text"
                    value={item.apiSDO}
                    onChange={(e) => update(i, 'apiSDO', e.target.value)}
                    readOnly={itemLocked}
                    className={itemLocked ? 'locked' : undefined}
                    onClick={() => { if (itemLocked) setLockAttemptIdx(i); }}
                    onBlur={() => setLockAttemptIdx((cur) => (cur === i ? null : cur))}
                  />
                </div>
              </div>
              {lockAttemptIdx === i && (
                <div className="status-banner error" style={{ marginBottom: 10 }}>{LOCKED_MESSAGE}</div>
              )}
              <div className="checkbox-row field">
                <input
                  type="checkbox"
                  id={`required-${title}-${i}`}
                  checked={item.required}
                  onChange={(e) => update(i, 'required', e.target.checked)}
                />
                <label htmlFor={`required-${title}-${i}`} style={{ marginBottom: 0 }}>{requiredMeaning}</label>
              </div>

              <div className="field">
                <label>Specification versions <span className="hint">each version's resources are managed separately</span></label>
                <div className="card-list">
                  {item.specifications.map((spec, specIdx) => (
                    <SpecVersionCard
                      key={specIdx}
                      apiId={item.id}
                      spec={spec}
                      onChange={(field, value) => updateSpec(i, specIdx, field, value)}
                      onChangeFields={(patch) => updateSpecFields(i, specIdx, patch)}
                      onRemove={() => removeSpec(i, specIdx)}
                      apiCatalog={apiCatalog}
                      removable={item.specifications.length > 1}
                    />
                  ))}
                </div>
                <button type="button" className="save" onClick={() => addSpec(i)}>+ Add specification version</button>
              </div>
            </div>
          );
        })}
        <button type="button" className="save" onClick={add}>+ Add API</button>
      </div>
      <datalist id="api-catalog-options">
        {apiCatalog.map((a) => <option key={a.key} value={a.id}>{a.name} (v{a.version})</option>)}
      </datalist>
    </div>
  );
}
