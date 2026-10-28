import React, { useEffect, useState } from 'react';
import yaml from 'js-yaml';
import { api } from '../api.js';
import { buildComponent, fileNamesFor, versionDirFor } from '../buildComponent.js';

// Suggested branch name, in the same form the component-specification-studio
// skill uses: component/TMFCnnn-<version>-<slug>.
function suggestedBranchName(state, version, mode) {
  return `component/${state.id.trim()}-${version}-${mode === 'edit' ? 'update' : 'new-component'}`;
}

// One line describing what a save will do to the version, from
// /api/version-impact.
function describeImpact(impact) {
  if (!impact) return null;
  if (impact.action === 'none') return `Nothing changed compared with the released ${impact.baseVersionDir}.`;
  if (impact.action === 'level-dropped') {
    return `This branch already moved to ${impact.workingVersionDir}, but the changes now only need ${impact.newVersionDir}.`;
  }
  const folder = {
    rename: `${impact.baseVersionDir} will be renamed to ${impact.newVersionDir}`,
    create: `a new folder ${impact.newVersionDir} will be created; ${impact.baseVersionDir} stays as released`,
    promote: `${impact.workingVersionDir} will become ${impact.newVersionDir}, and ${impact.baseVersionDir} is restored as released`,
    use: `saves into ${impact.newVersionDir}, already on this branch`,
  }[impact.action];
  return `Version ${impact.baseVersion} → ${impact.newVersion} (${impact.level === 'minor' ? 'mandatory API change' : 'other change'}): ${folder}. Reason: ${impact.reason}.`;
}

export default function ReviewStep({ state, original, originalLocation, mode, onSaved, onPushed }) {
  const [validation, setValidation] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [pushResult, setPushResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [branchName, setBranchName] = useState('');
  // Whether the branch name box still holds a suggestion (and may be
  // refreshed as the version is worked out) rather than a name the user
  // typed or the server already had.
  const [branchIsSuggestion, setBranchIsSuggestion] = useState(false);
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
  // The version a save would give an already-released component - see
  // versionImpact in server/specRules.js. null for a new component.
  const [impact, setImpact] = useState(null);
  const [impactError, setImpactError] = useState(null);

  const component = buildComponent(state, original);
  const yamlText = yaml.dump(component, { sortKeys: false, lineWidth: -1, noArrayIndent: true });
  const { dirName, fileName } = mode === 'edit' && originalLocation ? originalLocation : fileNamesFor(state);
  const released = impact && !impact.isNew;
  const versionDir = released ? impact.newVersionDir : versionDirFor(state);
  const targetVersion = released ? impact.newVersion : state.version.trim();

  useEffect(() => {
    api.branchName().then((r) => {
      // The server's own default (web-studio/<user>/<session>) is replaced by
      // a suggestion in the component/TMFCnnn-<version>-<slug> form.
      if (r.branch.startsWith('web-studio/')) {
        setBranchName(suggestedBranchName(state, targetVersion, mode));
        setBranchIsSuggestion(true);
      } else {
        setBranchName(r.branch);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (branchIsSuggestion) setBranchName(suggestedBranchName(state, targetVersion, mode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetVersion, branchIsSuggestion]);

  // Re-works out the version whenever the content changes, for an existing
  // component only (a new one keeps the version typed on the Metadata step).
  useEffect(() => {
    if (mode !== 'edit' || !dirName) { setImpact(null); return undefined; }
    const timer = setTimeout(() => {
      api.versionImpact({ component, dirName })
        .then((r) => {
          if (r.ok) { setImpact(r); setImpactError(null); } else { setImpact(null); setImpactError(r.error); }
        })
        .catch((err) => { setImpact(null); setImpactError(err.message); });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yamlText, mode, dirName]);

  const confirmBranchName = async () => {
    setRenaming(true);
    setRenameError(null);
    try {
      const result = await api.setBranchName(branchName.trim());
      if (result.ok) { setBranchName(result.branch); setConfirmed(true); setBranchIsSuggestion(false); }
      else setRenameError(result.error);
    } catch (err) {
      setRenameError(err.message);
    } finally {
      setRenaming(false);
    }
  };

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

  // keepVersion: keep a version folder this branch already bumped to, when
  // the changes no longer need that high a version (level-dropped).
  const runSave = async (force = false, keepVersion = false) => {
    setBusy(true);
    try {
      const result = await api.save({
        component, dirName, versionDir, fileName, force: force || mode === 'edit', keepVersion,
      });
      setSaveResult(result);
      if (result.ok) {
        setValidation({ valid: true, errors: [] });
        // Lets App.jsx keep originalLocation/original/the form's version and
        // its own dirty-check snapshot in sync with what the server actually
        // wrote - the server may have set a different version and folder.
        const savedText = onSaved?.({
          dirName: result.dirName, versionDir: result.versionDir, fileName: result.fileName, component: result.component,
        });
        setLastSavedYamlText(savedText ?? yamlText);
        setLastValidatedYamlText(savedText ?? yamlText);
      }
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
  // the real repo (hosted mode) - the branch name is whatever was just
  // confirmed above, never the auto-generated default. The server runs the
  // spec repo's CI check first; force pushes despite a failed check.
  const runPush = async (force = false) => {
    setPushing(true);
    setPushResult(null);
    try {
      const result = await api.pushToOrigin(force);
      setPushResult(result);
      // Back to the initial gated state after an actual push - Save to
      // Worktree re-enables, Confirm re-greys, Push re-disables - so the
      // next push requires the whole save-then-confirm sequence again
      // rather than firing again against content that's already been sent.
      if (result.ok && result.committed) { setLastSavedYamlText(null); setConfirmed(false); }
      // The server's working tree only actually moves onto the pushed
      // branch as part of this push - refresh App.jsx's repoInfo so the
      // Live YAML pane's "Copy GitHub link" stops pointing at whatever
      // branch was checked out before (e.g. main), and starts pointing at
      // the branch the content actually landed on.
      if (result.ok) onPushed?.();
    } catch (err) {
      setPushResult({ ok: false, error: err.message });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Review &amp; Save</h3>
      <div className="field">
        <label>Will be saved to</label>
        <code>specifications/{dirName}/{versionDir}/{fileName}</code>
        {released && <p className="hint" style={{ marginTop: 6 }}>{describeImpact(impact)}</p>}
        {impact?.warnings?.map((w) => <p key={w} className="hint" style={{ color: 'var(--danger)' }}>{w}</p>)}
        {impactError && <p className="hint" style={{ color: 'var(--danger)', marginTop: 6 }}>Couldn't work out the version: {impactError}</p>}
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
        <div className="status-banner ok">
          Saved to {saveResult.path}
          {saveResult.impact && saveResult.impact.action !== 'use' && ` (version ${saveResult.impact.baseVersion} → ${saveResult.impact.newVersion})`}
        </div>
      )}
      {saveResult && !saveResult.ok && saveResult.code === 'level-dropped' && (
        <div className="status-banner error">
          {saveResult.error}
          <div style={{ marginTop: 8 }}>
            <button className="danger" onClick={() => runSave(false, true)} disabled={busy}>Keep {saveResult.impact.workingVersionDir}</button>
          </div>
        </div>
      )}
      {saveResult && !saveResult.ok && saveResult.status === 409 && !saveResult.code && (
        <div className="status-banner error">
          {saveResult.error}
          <div style={{ marginTop: 8 }}>
            <button className="danger" onClick={() => runSave(true)} disabled={busy}>Overwrite anyway</button>
          </div>
        </div>
      )}
      {saveResult && !saveResult.ok && (saveResult.status !== 409 || saveResult.code === 'no-change') && (
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
        <div className="status-banner ok">
          Pushed to <code>{pushResult.branch}</code> on origin.
        </div>
      )}
      {pushResult && pushResult.ok && !pushResult.committed && (
        <div className="status-banner ok">
          Nothing to push - no changes since the last push.
        </div>
      )}
      {pushResult && !pushResult.ok && pushResult.code === 'ci-check-failed' && (
        <div className="status-banner error">
          {pushResult.checkRan
            ? 'Not pushed: the repo\'s CI check (ci/validateComponents.py) failed:'
            : 'Not pushed: the repo\'s CI check (ci/validateComponents.py) couldn\'t run:'}
          <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{pushResult.error}</pre>
          <button className="danger" onClick={() => runPush(true)} disabled={pushing}>Push anyway</button>
        </div>
      )}
      {pushResult && !pushResult.ok && pushResult.code !== 'ci-check-failed' && (
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
        <label>Branch name to be created on origin Repo (suggested form: component/TMFCnnn-&lt;version&gt;-&lt;short-description&gt;)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={branchName}
            onChange={(e) => { setBranchName(e.target.value); setConfirmed(false); setBranchIsSuggestion(false); }}
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
        <button className={canPush ? 'save-solid' : 'save'} onClick={() => runPush(false)} disabled={pushing || !canPush}>
          {pushing ? 'Pushing…' : 'Push to origin Repo'}
        </button>
      </div>
    </div>
  );
}
