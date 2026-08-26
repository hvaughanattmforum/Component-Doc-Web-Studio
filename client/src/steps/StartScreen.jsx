import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function StartScreen({ onCreateNew, onEditExisting }) {
  const [components, setComponents] = useState([]);
  const [selected, setSelected] = useState('');
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.components().then((r) => setComponents(r.components)).catch((err) => setError(err.message));
  }, []);

  // Each component can have several released version subfolders - fetch
  // them (latest first) whenever the selected component changes, so the
  // version dropdown always reflects what's actually on disk rather than
  // just the one version /api/components happened to summarize.
  useEffect(() => {
    setVersions([]);
    setSelectedVersion('');
    if (!selected) return;
    api.componentVersions(selected)
      .then((r) => {
        setVersions(r.versions);
        setSelectedVersion(r.versions[0] || '');
      })
      .catch((err) => setError(err.message));
  }, [selected]);

  const load = async () => {
    if (!selected || !selectedVersion) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.component(selected, selectedVersion);
      onEditExisting(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>What do you want to do?</h3>

      <div className="card" style={{ marginBottom: 16 }}>
        <strong>Create a new component</strong>
        <p className="hint" style={{ margin: '4px 0 12px' }}>Start a fresh TMFCxxx specification from scratch.</p>
        <button className="primary" onClick={onCreateNew}>Create new component</button>
      </div>

      <div className="card">
        <strong>Edit an existing component</strong>
        <p className="hint" style={{ margin: '4px 0 12px' }}>Load an existing specification and change it.</p>
        <div className="row">
          <div className="field">
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select a component...</option>
              {components.map((c) => (
                <option key={c.dirName} value={c.dirName}>
                  {c.id} - {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <select value={selectedVersion} onChange={(e) => setSelectedVersion(e.target.value)} disabled={!selected || versions.length === 0}>
              {versions.length === 0 && <option value="">{selected ? 'Loading versions...' : 'Select a component first'}</option>}
              {versions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <button onClick={load} disabled={!selected || !selectedVersion || loading}>{loading ? 'Loading...' : 'Load'}</button>
        </div>
        {error && <div className="status-banner error">{error}</div>}
      </div>
    </div>
  );
}
