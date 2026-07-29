import React, { useState } from 'react';
import { api } from '../api.js';
import { matchCatalogEntry } from '../apiCatalogUtils.js';

// Verbs are stored as a comma-separated string on the resource row (e.g.
// "GET, GET /id, POST") - this turns an already-captured resource's saved
// verbs back into a Set so the picker's checkboxes can be pre-filled with
// what's actually already selected, instead of starting blank every time.
function existingVerbsFor(existingResources, name) {
  const found = existingResources.find((er) => er.name === name);
  if (!found) return new Set();
  return new Set((found.verbs || '').split(',').map((v) => v.trim()).filter(Boolean));
}

export default function ResourcePicker({ apiId, apiVersion, apiCatalog, existingResources, onAdd, onResourcesLoaded }) {
  const [resources, setResources] = useState(null);
  const [checked, setChecked] = useState({}); // { [resourceName]: Set(verbs) }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const match = matchCatalogEntry(apiCatalog, (apiId || '').trim(), apiVersion);

  const load = async () => {
    if (!match) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.apiResources(match.swagger);
      setResources(result.resources);
      onResourcesLoaded?.(result.resources);
      const initialChecked = {};
      // Pre-fill from whatever's already captured for this resource, rather
      // than always starting from an empty selection - this is what lets an
      // already-added resource's operations be edited (added to or removed
      // from) instead of only ever being appended to blind.
      result.resources.forEach((r) => { initialChecked[r.name] = existingVerbsFor(existingResources, r.name); });
      setChecked(initialChecked);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (resourceName, verb) => {
    setChecked((prev) => {
      const next = new Set(prev[resourceName]);
      if (next.has(verb)) next.delete(verb); else next.add(verb);
      return { ...prev, [resourceName]: next };
    });
  };

  const save = (resourceName) => {
    const verbs = [...(checked[resourceName] || [])];
    if (!verbs.length) return;
    onAdd(resourceName, verbs);
  };

  // One-click shortcut for "check every operation, then Add" - also updates
  // the checkboxes themselves (not just the saved result) so they stay in
  // sync if the user wants to then uncheck one and re-save.
  const addAll = (resourceName, operations) => {
    const all = new Set(operations);
    setChecked((prev) => ({ ...prev, [resourceName]: all }));
    onAdd(resourceName, [...all]);
  };

  if (!apiId) return null;

  return (
    <div className="field">
      <label>Resource picker <span className="hint">from the API's real swagger spec</span></label>
      {!match && <div className="hint">No catalog entry found for {apiId}{apiVersion ? ` v${apiVersion}` : ''} - use the resource rows below manually.</div>}
      {match && (
        <button type="button" className="save" onClick={load} disabled={loading}>
          {loading ? 'Loading spec...' : `Load resources from ${match.id} v${match.version} spec`}
        </button>
      )}
      {error && <div className="status-banner error" style={{ marginTop: 8 }}>{error}</div>}

      {resources && (
        <div className="card-list" style={{ marginTop: 10, maxHeight: 280, overflowY: 'auto' }}>
          {resources.map((r) => {
            const already = existingResources.some((er) => er.name === r.name);
            const hasSelection = !!checked[r.name]?.size;
            return (
              <div className="card" key={r.name}>
                <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                  <strong style={{ flex: 1 }}>{r.name}{already ? ' (already added)' : ''}</strong>
                  <button type="button" className={hasSelection ? 'save' : 'save-solid'} onClick={() => addAll(r.name, r.operations)}>
                    Add All
                  </button>
                  <button type="button" className="save" onClick={() => save(r.name)} disabled={!hasSelection}>
                    {already ? 'Edit operations' : '+ Add'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                  {r.operations.map((verb) => (
                    <label key={verb} className="checkbox-row" style={{ fontSize: '0.82rem' }}>
                      <input
                        type="checkbox"
                        checked={checked[r.name]?.has(verb) || false}
                        onChange={() => toggle(r.name, verb)}
                      />
                      {verb}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
