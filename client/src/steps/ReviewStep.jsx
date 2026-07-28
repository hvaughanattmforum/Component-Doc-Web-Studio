import React, { useEffect, useState } from 'react';
import yaml from 'js-yaml';
import { api } from '../api.js';
import { buildComponent, fileNamesFor } from '../buildComponent.js';

export default function ReviewStep({ state, original, originalLocation, mode }) {
  const [validation, setValidation] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [pushResult, setPushResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [savedBranchName, setSavedBranchName] = useState(''); // last name confirmed with the server
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState(null);

  useEffect(() => {
    api.branchName().then((r) => { setBranchName(r.branch); setSavedBranchName(r.branch); }).catch(() => {});
  }, []);

  const renameBranch = async () => {
    setRenaming(true);
    setRenameError(null);
    try {
      const result = await api.setBranchName(branchName.trim());
      if (result.ok) { setBranchName(result.branch); setSavedBranchName(result.branch); }
      else setRenameError(result.error);
    } catch (err) {
      setRenameError(err.message);
    } finally {
      setRenaming(false);
    }
  };

  const component = buildComponent(state, original);
  const yamlText = yaml.dump(component, { sortKeys: false, lineWidth: -1, noArrayIndent: true });
  const { dirName, fileName } = mode === 'edit' && originalLocation ? originalLocation : fileNamesFor(state);

  const runValidate = async () => {
    setBusy(true);
    setSaveResult(null);
    try {
      const result = await api.validate(component);
      setValidation(result);
    } catch (err) {
      setValidation({ valid: false, errors: [{ message: err.message }] });
    } finally {
      setBusy(false);
    }
  };

  const runSave = async (force = false) => {
    setBusy(true);
    try {
      const result = await api.save({ component, dirName, fileName, force: force || mode === 'edit' });
      setSaveResult(result);
      if (result.ok) setValidation({ valid: true, errors: [] });
    } catch (err) {
      setSaveResult({ ok: false, error: err.message });
    } finally {
      setBusy(false);
    }
  };

  // Separate from Save above: Save only ever writes locally (to the active
  // worktree/workspace); this is the explicit, deliberate action that
  // actually commits and pushes those local changes to a feature branch on
  // the real repo - no PR is opened here.
  const runPush = async () => {
    setPushing(true);
    setPushResult(null);
    try {
      const result = await api.pushToOrigin();
      setPushResult(result);
    } catch (err) {
      setPushResult({ ok: false, error: err.message });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Review &amp; save</h3>
      <div className="field">
        <label>{mode === 'edit' ? 'Will update' : 'Will be saved to'}</label>
        <code>specifications/{dirName}/{fileName}</code>
      </div>

      {validation && !validation.valid && (
        <div className="status-banner error">
          Schema validation failed:
          <ul className="errors-list">
            {validation.errors.map((e, i) => (
              <li key={i}>{e.instancePath ? `${e.instancePath} ` : ''}{e.message}</li>
            ))}
          </ul>
        </div>
      )}
      {validation && validation.valid && (
        <div className="status-banner ok">Valid against component.schema.json.</div>
      )}

      {saveResult && saveResult.ok && (
        <div className="status-banner ok">Saved to {saveResult.path}</div>
      )}
      {saveResult && !saveResult.ok && saveResult.status === 409 && (
        <div className="status-banner error">
          {saveResult.error}
          <div style={{ marginTop: 8 }}>
            <button className="danger" onClick={() => runSave(true)} disabled={busy}>Overwrite anyway</button>
          </div>
        </div>
      )}
      {saveResult && !saveResult.ok && saveResult.status !== 409 && (
        <div className="status-banner error">
          {saveResult.error}
          {saveResult.errors && (
            <ul className="errors-list">
              {saveResult.errors.map((e, i) => (
                <li key={i}>{e.instancePath ? `${e.instancePath} ` : ''}{e.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pushResult && pushResult.ok && pushResult.committed && (
        <div className="status-banner ok">Pushed to <code>{pushResult.branch}</code> on origin.</div>
      )}
      {pushResult && pushResult.ok && !pushResult.committed && (
        <div className="status-banner ok">Nothing to push - no changes since the last push.</div>
      )}
      {pushResult && !pushResult.ok && (
        <div className="status-banner error">{pushResult.error}</div>
      )}

      <div className="field">
        <label>Branch name (used by "Push to origin Repo")</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            style={{ flex: 1 }}
            disabled={renaming}
          />
          <button type="button" onClick={renameBranch} disabled={renaming || !branchName.trim() || branchName.trim() === savedBranchName}>
            {renaming ? 'Renaming…' : 'Rename'}
          </button>
        </div>
        {renameError && <div className="hint" style={{ color: 'var(--danger)', marginTop: 4 }}>{renameError}</div>}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button onClick={runValidate} disabled={busy}>Validate</button>
        <button className="save" onClick={() => runSave(false)} disabled={busy}>Save to Worktree</button>
        <button className="primary" onClick={runPush} disabled={pushing}>{pushing ? 'Pushing…' : 'Push to origin Repo'}</button>
      </div>

      <pre className="yaml-preview">{yamlText}</pre>
    </div>
  );
}
