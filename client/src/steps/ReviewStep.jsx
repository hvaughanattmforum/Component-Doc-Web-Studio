import React, { useEffect, useState } from 'react';
import yaml from 'js-yaml';
import { api } from '../api.js';
import { buildComponent, fileNamesFor, versionDirFor } from '../buildComponent.js';

export default function ReviewStep({ state, original, originalLocation, mode }) {
  const [validation, setValidation] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [pushResult, setPushResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState(null);
  // Push stays disabled until this specific name has been explicitly
  // confirmed via the button below - editing the text box again (even back
  // to a previously-confirmed value) requires re-confirming before Push
  // re-enables, so Push can never fire against a name the user hasn't
  // actually clicked to confirm.
  const [confirmed, setConfirmed] = useState(false);
  // Set to the exact YAML text that was actually written to disk by the
  // most recent successful save - compared against the live yamlText below
  // to tell whether "the current content" has been saved yet, rather than
  // just "was Save ever clicked."
  const [lastSavedYamlText, setLastSavedYamlText] = useState(null);
  // Same idea for Validate: the exact YAML text as of the most recent
  // validate call, regardless of whether it passed.
  const [lastValidatedYamlText, setLastValidatedYamlText] = useState(null);

  useEffect(() => {
    api.branchName().then((r) => setBranchName(r.branch)).catch(() => {});
  }, []);

  const confirmBranchName = async () => {
    setRenaming(true);
    setRenameError(null);
    try {
      const result = await api.setBranchName(branchName.trim());
      if (result.ok) { setBranchName(result.branch); setConfirmed(true); }
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
  const versionDir = versionDirFor(state);
  // Bumping the version field while editing targets a brand-new version
  // subfolder rather than overwriting the one that was loaded - the old
  // version's files are left untouched, matching how a real version release
  // adds a new TMFCxxx-vX.Y.Z folder alongside the existing ones.
  const isNewVersion = mode === 'edit' && originalLocation && originalLocation.versionDir !== versionDir;

  const runValidate = async () => {
    setBusy(true);
    setSaveResult(null);
    try {
      const result = await api.validate(component);
      setValidation(result);
    } catch (err) {
      setValidation({ valid: false, errors: [{ message: err.message }] });
    } finally {
      setLastValidatedYamlText(yamlText);
      setBusy(false);
    }
  };

  const runSave = async (force = false) => {
    setBusy(true);
    try {
      const result = await api.save({ component, dirName, versionDir, fileName, force: force || (mode === 'edit' && !isNewVersion) });
      setSaveResult(result);
      if (result.ok) { setValidation({ valid: true, errors: [] }); setLastSavedYamlText(yamlText); }
    } catch (err) {
      setSaveResult({ ok: false, error: err.message });
    } finally {
      setBusy(false);
    }
  };

  // True only once the *current* YAML content has actually passed
  // validation - editing anything afterward flips this back to false until
  // Validate runs again, same pattern as hasSavedCurrentContent below.
  const hasValidatedCurrentContent = validation?.valid === true && lastValidatedYamlText === yamlText;

  // True only once the *current* YAML content (not just some earlier
  // version of it) has been successfully saved - editing anything after a
  // save flips this back to false until Save to Worktree runs again.
  const hasSavedCurrentContent = lastSavedYamlText !== null && yamlText === lastSavedYamlText;

  // Push only looks "ready" (vivid save-solid green) once a save of the
  // current content has actually happened - and stays disabled outright
  // until both that save and the branch-name confirmation have happened.
  const canPush = hasSavedCurrentContent && confirmed;

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
      // Back to the initial gated state after an actual push - Save to
      // Worktree re-enables, Confirm re-greys, Push re-disables - so the
      // next push requires the whole save-then-confirm sequence again
      // rather than firing again against content that's already been sent.
      if (result.ok && result.committed) { setLastSavedYamlText(null); setConfirmed(false); }
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
        <label>{mode === 'edit' && !isNewVersion ? 'Will update' : 'Will be saved to'}</label>
        <code>specifications/{dirName}/{versionDir}/{fileName}</code>
        {isNewVersion && (
          <p className="hint" style={{ marginTop: 6 }}>
            This creates a new version folder ({versionDir}) — the original {originalLocation.versionDir} is left untouched.
          </p>
        )}
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

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button className={hasValidatedCurrentContent ? 'save' : 'save-solid'} onClick={runValidate} disabled={busy}>Validate</button>
        <button className={hasSavedCurrentContent ? 'save' : 'save-solid'} onClick={() => runSave(false)} disabled={busy || hasSavedCurrentContent || !hasValidatedCurrentContent}>Save to Worktree</button>
      </div>

      {/* No YAML preview here anymore - it's now shown persistently in the
          shell's right-hand pane (see App.jsx's previewYamlText) across
          every step, not just this one. */}

      <div className="field" style={{ marginTop: 16 }}>
        <label>Branch name to be created on origin Repo (use meaningful e.g. fix/20260729-TMFC003)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={branchName}
            onChange={(e) => { setBranchName(e.target.value); setConfirmed(false); }}
            style={{ flex: 1 }}
            disabled={renaming}
          />
          <button
            type="button"
            className={confirmed ? 'save' : 'save-solid'}
            onClick={confirmBranchName}
            disabled={renaming || !branchName.trim() || !hasSavedCurrentContent}
          >
            {renaming
              ? 'Confirming…'
              : confirmed
                ? 'Change Name of branch in Origin repo'
                : 'Confirm Branch Name to be created in Origin Repo'}
          </button>
        </div>
        {renameError && <div className="hint" style={{ color: 'var(--danger)', marginTop: 4 }}>{renameError}</div>}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button className={canPush ? 'save-solid' : 'save'} onClick={runPush} disabled={pushing || !canPush}>
          {pushing ? 'Pushing…' : 'Push to origin Repo'}
        </button>
      </div>
    </div>
  );
}
