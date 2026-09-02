import React, { useCallback, useEffect, useState } from 'react';
import yaml from 'js-yaml';
import { api } from './api.js';
import { buildComponent } from './buildComponent.js';
import StartScreen from './steps/StartScreen.jsx';
import MetadataStep from './steps/MetadataStep.jsx';
import LinksStep from './steps/LinksStep.jsx';
import ApiListStep from './steps/ApiListStep.jsx';
import EventsStep from './steps/EventsStep.jsx';
import DiffStep from './steps/DiffStep.jsx';
import ReviewStep from './steps/ReviewStep.jsx';
import DocumentHistoryStep from './steps/DocumentHistoryStep.jsx';
import DescriptionsStep from './steps/DescriptionsStep.jsx';
import SetupGuide from './SetupGuide.jsx';
import HelpButton from './HelpButton.jsx';
import BranchSwitcher from './BranchSwitcher.jsx';
import HighlightablePane from './HighlightablePane.jsx';
import CreateIssuePanel from './CreateIssuePanel.jsx';
import { stateFromComponent } from './parseComponent.js';

const STEPS = ['Metadata', 'Links', 'Descriptions', 'Exposed APIs', 'Dependent APIs', 'Events', 'Compare Changes', 'Review & Save', 'Document History'];

// Shared with the "is this the same content as what's on disk" check below -
// must stay identical to whatever ReviewStep.jsx dumps YAML with, since
// that's the snapshot `original` is compared against.
const YAML_OPTS = { sortKeys: false, lineWidth: -1, noArrayIndent: true };

// Which file each step edits: most steps build up `state` and only write it
// to the component's main YAML when Review & Save is used, while Links,
// Descriptions and Document History write straight to their own .md files
// under that component's Diagrams/ folder (see LinksStep.jsx /
// DescriptionsStep.jsx / DocumentHistoryStep.jsx) independently of the
// YAML/Save flow. Grouped here purely for the step pills' display below -
// doesn't affect step order or navigation. Also used to decide what the
// right-hand pane shows (see sidePanes below) - steps in the second group
// show that step's own live .md preview(s) there instead of the Live YAML.
const STEP_GROUPS = [
  { label: 'Component YAML', indices: [0, 3, 4, 5, 6, 7] },
  { label: 'Component Spec Document', indices: [1, 2, 8] },
];
const MD_PREVIEW_STEPS = new Set(STEP_GROUPS[1].indices);

function blankState() {
  return {
    id: '',
    name: '',
    description: '',
    version: '1.0.0',
    status: 'roadmap',
    publicationDate: new Date().toISOString().slice(0, 10),
    functionalBlock: '',
    owners: [],
    maintainers: [],
    eTOMs: [],
    functionalFrameworkFunctions: [],
    SIDs: [],
    exposedAPIs: [{ id: '', apiSDO: 'tmForum', required: true, name: '', specifications: [{ version: '', resources: [], raw: {} }] }],
    dependentAPIs: [],
    publishedEvents: [],
    subscribedEvents: [],
  };
}

export default function App() {
  const [view, setView] = useState('wizard'); // 'wizard' | 'setup'
  const [mode, setMode] = useState(null); // null | 'new' | 'edit'
  const [step, setStep] = useState(0);
  const [state, setState] = useState(blankState());
  const [original, setOriginal] = useState(null); // raw loaded component, for edit mode
  const [originalLocation, setOriginalLocation] = useState(null); // { dirName, fileName }
  const [functionalBlocks, setFunctionalBlocks] = useState([]);
  const [apiCatalog, setApiCatalog] = useState([]);
  const [apiCatalogError, setApiCatalogError] = useState(null);
  const [repoInfo, setRepoInfo] = useState(null);
  const [authUser, setAuthUser] = useState(undefined); // undefined = loading, null = signed out
  // Permalinks the user has highlighted from any HighlightablePane (the Live
  // YAML pane, or one of the five hand-edited .md files' own preview panes)
  // and queued up to reference in one GitHub issue - see
  // HighlightablePane.jsx/CreateIssuePanel.jsx.
  const [issueDraft, setIssueDraft] = useState([]);
  // A row range carried in from a permalink URL
  // (?open=&version=&step=&pane=&lines=), consumed once by whichever pane's
  // paneKey matches `pendingSelectionPane` to seed its selection - see the
  // effect below and HighlightablePane's initialSelectionPane prop.
  const [pendingSelection, setPendingSelection] = useState(null);
  const [pendingSelectionPane, setPendingSelectionPane] = useState(null);
  // The exact YAML text of the most recently loaded-or-saved snapshot of the
  // open component, for the isDirty check below - deliberately NOT compared
  // against `original` directly (buildComponent/stateFromComponent aren't
  // guaranteed to round-trip byte-for-byte - see parseComponent.js's `raw`
  // fields), only ever against another call to the same dump pipeline, so a
  // freshly loaded/saved component always compares equal to itself.
  const [savedYamlText, setSavedYamlText] = useState(null);
  // Live preview info reported up by whichever of Links/Descriptions/
  // Document History is currently mounted (see onPreviewReady below) -
  // keyed by paneKey so Descriptions' three tables can all report at once.
  // Rendered in the right-hand pane in place of the Live YAML pane for
  // those steps (see sidePanes below) - populated/cleared entirely by the
  // step components themselves, so App.jsx never needs to know their
  // internal load/save state.
  const [stepPanes, setStepPanes] = useState({});

  // Stable identity (empty dep array - setStepPanes from useState is itself
  // stable) so passing this down doesn't re-trigger a step panel's own
  // reporting effect just because App.jsx re-rendered for an unrelated
  // reason - see the effect in LinksStep.jsx/DescriptionsStep.jsx/
  // DocumentHistoryStep.jsx that calls this.
  const handlePreviewReady = useCallback((paneKey, info) => {
    setStepPanes((prev) => {
      if (!info) {
        if (!(paneKey in prev)) return prev;
        const next = { ...prev };
        delete next[paneKey];
        return next;
      }
      return { ...prev, [paneKey]: info };
    });
  }, []);

  const refreshRepoInfo = () => api.health().then(setRepoInfo).catch(() => setRepoInfo({ ok: false }));

  const refreshApiCatalog = () => {
    setApiCatalogError(null);
    return api.apis()
      .then((r) => setApiCatalog(r.apis))
      .catch((err) => setApiCatalogError(err.message || 'Failed to load the API catalog.'));
  };

  // /api/health and /api/me are the only endpoints a signed-out client may
  // call, so the repo-connection banner can show before sign-in but every
  // other data load below waits until authUser is known to be signed in.
  useEffect(() => {
    refreshRepoInfo();
    api.me().then((r) => setAuthUser(r.user)).catch(() => setAuthUser(null));
  }, []);

  useEffect(() => {
    if (!authUser) return;
    api.functionalBlocks().then((r) => setFunctionalBlocks(r.functionalBlocks)).catch(() => {});
    // The very first /api/health call (mount effect above) fires before
    // this user has a workspace yet - refreshApiCatalog is a protected
    // route, so by the time it settles the server has created one (see
    // resolveRepoRoot's session.workspaceDir fallback in server/index.js).
    // Re-fetching afterward is what actually gets "Connected to... on
    // branch..." (and the branch switcher behind it) to appear without the
    // user having to manually reload the page after signing in.
    refreshApiCatalog().finally(refreshRepoInfo);
  }, [authUser]);

  const signOut = () => api.logout().then(() => setAuthUser(null)).catch(() => {});

  const startCreate = () => {
    setOriginal(null);
    setOriginalLocation(null);
    setSavedYamlText(null);
    setState(blankState());
    api.nextId().then((r) => setState((s) => ({ ...s, id: r.id }))).catch(() => {});
    setMode('new');
    setStep(0);
  };

  const startEdit = ({ component, dirName, versionDir, fileName }) => {
    const newState = stateFromComponent(component);
    setOriginal(component);
    setOriginalLocation({ dirName, versionDir, fileName });
    // Computed the same way previewYamlText below will compute it on the
    // next render (buildComponent(newState, component)), so it's guaranteed
    // to compare equal - see the savedYamlText comment above.
    setSavedYamlText(yaml.dump(buildComponent(newState, component), YAML_OPTS));
    setState(newState);
    setMode('edit');
    setStep(0);
  };

  // Called by ReviewStep after a successful save, so a permalink copied
  // right after saving reflects the just-saved location/content rather than
  // the stale one from when this component was first opened - fixes
  // permalinks silently pointing at the old version folder after a
  // version-bump save (originalLocation), and re-enables permalinks/GitHub
  // links that isDirty had disabled for unsaved edits (savedYamlText).
  const onComponentSaved = ({ dirName, versionDir, fileName, component, yamlText }) => {
    setOriginalLocation({ dirName, versionDir, fileName });
    setOriginal(component);
    setSavedYamlText(yamlText);
  };

  const backToStart = () => {
    setMode(null);
    setStep(0);
  };

  // Opens a permalink copied from any pane's selection toolbar
  // (?open=<dirName>&version=<versionDir>&step=<n>&pane=<paneKey>&lines=<start>-<end>)
  // - waits for sign-in to resolve, and only fires while at the start screen
  // so it never hijacks a wizard already in progress. `pane` says which
  // HighlightablePane instance should claim pendingSelection once it's
  // mounted (only one pane is ever the YAML pane, but a step like
  // Descriptions renders three of its own) - see
  // HighlightablePane.jsx's initialSelectionPane prop.
  useEffect(() => {
    if (!authUser || mode !== null) return;
    const params = new URLSearchParams(window.location.search);
    const open = params.get('open');
    if (!open) return;
    const version = params.get('version') || undefined;
    const stepParam = parseInt(params.get('step'), 10);
    const pane = params.get('pane');
    const linesMatch = (params.get('lines') || '').match(/^(\d+)-(\d+)$/);

    api.component(open, version).then((r) => {
      startEdit({ component: r.component, dirName: r.dirName, versionDir: r.versionDir, fileName: r.fileName });
      if (!Number.isNaN(stepParam)) setStep(Math.min(STEPS.length - 1, Math.max(0, stepParam)));
      if (linesMatch) {
        setPendingSelection({ start: parseInt(linesMatch[1], 10), end: parseInt(linesMatch[2], 10) });
        setPendingSelectionPane(pane);
      }
      window.history.replaceState({}, '', window.location.pathname);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, mode]);

  // Live preview shown persistently in the right-hand pane while a wizard is
  // in progress - read-only, purely a mirror of buildComponent(state,
  // original) (the same function ReviewStep uses for the real save/validate
  // calls), so it can never drift from what those actions would actually do.
  const previewYamlText = mode !== null
    ? yaml.dump(buildComponent(state, original), YAML_OPTS)
    : '';

  // Whether the live buffer has diverged from the last loaded-or-saved
  // snapshot (savedYamlText, kept in sync by startEdit/onComponentSaved
  // above) - a permalink's line numbers only mean anything if they match
  // what's actually on disk/GitHub, so the pane below disables both
  // copy-link buttons while this is true.
  const isDirty = mode === 'edit' && savedYamlText !== null && previewYamlText !== savedYamlText;

  // Formerly computed inside YamlPane.jsx itself before it was generalized
  // into HighlightablePane.jsx (now shared with the five hand-edited .md
  // files' own preview panes) - each caller now works out its own
  // "is there really a saved file to permalink to" condition.
  const yamlCanPermalink = mode === 'edit' && Boolean(originalLocation) && !isDirty;
  const yamlPermalinkDisabledReason = mode !== 'edit' || !originalLocation
    ? 'Save this component first to generate a permalink.'
    : isDirty
      ? 'Save your changes first - permalinks need to match the saved file.'
      : undefined;
  const yamlRelativePath = originalLocation
    ? `specifications/${originalLocation.dirName}/${originalLocation.versionDir}/${originalLocation.fileName}`
    : null;

  // Shared by every HighlightablePane on the page (the YAML pane and any of
  // the five .md-file preview panes) so they all feed the same issue draft.
  const addToIssueDraft = (entry) => setIssueDraft((d) => [...d, { ...entry, id: crypto.randomUUID() }]);

  // What the right-hand pane shows: on a Component Spec Document step
  // (Links/Descriptions/Document History), whatever those steps have
  // reported via onPreviewReady (Descriptions reports up to three at once);
  // everywhere else, the single persistent Live YAML pane.
  const sidePanes = MD_PREVIEW_STEPS.has(step)
    ? Object.entries(stepPanes).map(([paneKey, info]) => ({ paneKey, ...info }))
    : [{
      paneKey: 'yaml',
      title: 'Live YAML',
      text: previewYamlText,
      dirName: originalLocation?.dirName,
      versionDir: originalLocation?.versionDir,
      relativePath: yamlRelativePath,
      canPermalink: yamlCanPermalink,
      permalinkDisabledReason: yamlPermalinkDisabledReason,
    }];

  return (
    <div className="app">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <h1>ODA Component Doc Specification Web Studio</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {authUser && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
              {authUser.avatarUrl && (
                <img src={authUser.avatarUrl} alt="" width={24} height={24} style={{ borderRadius: '50%' }} />
              )}
              {authUser.name || authUser.login}
              <button onClick={signOut}>Sign out</button>
            </span>
          )}
          <CreateIssuePanel
            draft={issueDraft}
            onRemove={(id) => setIssueDraft((d) => d.filter((e) => e.id !== id))}
            onClear={() => setIssueDraft([])}
            defaultTitle={state.id ? `${state.id}: review needed` : 'Review needed'}
          />
          <HelpButton />
        </div>
      </div>
      {repoInfo?.git && (repoInfo.git.remote || repoInfo.git.branch) && (
        <p className="repo-connection">
          Connected to{' '}
          {repoInfo.git.remoteUrl ? (
            <a href={repoInfo.git.remoteUrl} target="_blank" rel="noreferrer">{repoInfo.git.remote}</a>
          ) : (
            <strong>{repoInfo.git.remote || 'unknown repo'}</strong>
          )}
          {repoInfo.git.branch && (
            <>
              {' '}on branch{' '}
              {authUser ? (
                <BranchSwitcher
                  currentBranch={repoInfo.git.branch}
                  repoInfo={repoInfo}
                  hasOpenWizard={mode !== null}
                  onGoToReviewStep={() => { setView('wizard'); setStep(STEPS.indexOf('Review & Save')); }}
                />
              ) : <code>{repoInfo.git.branch}</code>}
            </>
          )}
        </p>
      )}
      <p className="subtitle">
        Create or edit a TMFCxxx component specification for the ODA Component Specification repository.
        {/* Strictly === false: health reports null when this deployment has no
            shared checkout to look in (per-user workspaces), and warning about
            a missing folder there would fire for every signed-out visitor. */}
        {repoInfo && repoInfo.specificationsDirExists === false && (
          <span style={{ color: 'var(--danger)' }}> Warning: specifications folder not found at configured REPO_ROOT.</span>
        )}
      </p>

      {authUser === undefined && <p>Loading…</p>}

      {authUser === null && (
        <div className="status-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>Sign in with GitHub to create or edit component specifications.</span>
          <button className="primary" onClick={() => { window.location.href = '/auth/github'; }}>Sign in with GitHub</button>
        </div>
      )}

      {authUser && (
      <>
      <div className="steps">
        <button className={`step-pill ${view === 'wizard' ? 'active' : ''}`} onClick={() => setView('wizard')}>Studio</button>
        <button className={`step-pill ${view === 'setup' ? 'active' : ''}`} onClick={() => setView('setup')}>Setup instructions</button>
      </div>

      {view === 'setup' && (
        <SetupGuide repoInfo={repoInfo} onFrameworksRegenerated={refreshRepoInfo} />
      )}

      {view === 'wizard' && mode === null && (
        <StartScreen onCreateNew={startCreate} onEditExisting={startEdit} />
      )}

      {view === 'wizard' && mode !== null && (
        <div className={`shell ${step === 6 ? 'shell-no-yaml' : ''}`}>
          <div className="rail">
            <button className="rail-item rail-start-over" onClick={backToStart}>&larr; Start over</button>
            {STEP_GROUPS.map((group, groupIdx) => (
              <div className="rail-group" key={group.label}>
                <div className="step-group-label">{group.label}</div>
                {group.indices.map((i, posIdx) => (
                  <button
                    key={STEPS[i]}
                    className={`rail-item ${i === step ? 'active' : ''}`}
                    onClick={() => setStep(i)}
                  >
                    <span className="n">{groupIdx + 1}.{posIdx + 1}</span> {STEPS[i]}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="main">
            {mode === 'edit' && (
              <div className="status-banner ok" style={{ marginBottom: 16 }}>
                Editing existing component {originalLocation?.dirName} ({originalLocation?.versionDir}). ID and name are locked to avoid orphaning its conformance profile/RI/diagram folders.
              </div>
            )}

            {apiCatalogError && [3, 4, 5].includes(step) && (
              <div className="status-banner error" style={{ marginBottom: 16 }}>
                Couldn't load the API catalog ({apiCatalogError}). The resource/event pickers can't resolve any
                API to its swagger spec until this succeeds — every API will show "No catalog entry found."{' '}
                <button type="button" onClick={refreshApiCatalog}>Retry</button>
              </div>
            )}

            {step === 0 && (
              <MetadataStep
                state={state}
                setState={setState}
                functionalBlocks={functionalBlocks}
                locked={mode === 'edit'}
              />
            )}
            {step === 1 && (
              <LinksStep
                dirName={originalLocation?.dirName}
                versionDir={originalLocation?.versionDir}
                eTOMs={state.eTOMs}
                SIDs={state.SIDs}
                onPreviewReady={handlePreviewReady}
              />
            )}
            {step === 2 && (
              <DescriptionsStep
                dirName={originalLocation?.dirName}
                versionDir={originalLocation?.versionDir}
                eTOMs={state.eTOMs}
                functionalFrameworkFunctions={state.functionalFrameworkFunctions}
                onPreviewReady={handlePreviewReady}
              />
            )}
            {step === 3 && (
              <ApiListStep
                title="Exposed APIs"
                requiredMeaning="Mandatory for Conformance"
                items={state.exposedAPIs}
                onChange={(v) => setState({ ...state, exposedAPIs: v })}
                apiCatalog={apiCatalog}
              />
            )}
            {step === 4 && (
              <ApiListStep
                title="Dependent APIs"
                requiredMeaning="Mandatory Dependency"
                items={state.dependentAPIs}
                onChange={(v) => setState({ ...state, dependentAPIs: v })}
                apiCatalog={apiCatalog}
              />
            )}
            {step === 5 && (
              <EventsStep state={state} setState={setState} apiCatalog={apiCatalog} />
            )}
            {step === 6 && (
              <DiffStep state={state} original={original} />
            )}
            {step === 7 && (
              <ReviewStep
                state={state}
                original={original}
                originalLocation={originalLocation}
                mode={mode}
                onSaved={onComponentSaved}
                onPushed={refreshRepoInfo}
              />
            )}
            {step === 8 && (
              <DocumentHistoryStep
                dirName={originalLocation?.dirName}
                versionDir={originalLocation?.versionDir}
                onPreviewReady={handlePreviewReady}
              />
            )}

            <div className="nav-buttons">
              <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</button>
              <button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={step === STEPS.length - 1}>Next</button>
            </div>
          </div>

          {step !== 6 && (
            <div className="side-pane-stack">
              {sidePanes.map((pane) => (
                <HighlightablePane
                  key={pane.paneKey}
                  title={pane.title}
                  text={pane.text}
                  dirName={pane.dirName}
                  versionDir={pane.versionDir}
                  relativePath={pane.relativePath}
                  canPermalink={pane.canPermalink}
                  permalinkDisabledReason={pane.permalinkDisabledReason}
                  repoInfo={repoInfo}
                  step={step}
                  paneKey={pane.paneKey}
                  initialSelection={pendingSelection}
                  initialSelectionPane={pendingSelectionPane}
                  onInitialSelectionApplied={() => setPendingSelection(null)}
                  onAddToIssueDraft={addToIssueDraft}
                />
              ))}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
