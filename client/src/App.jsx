import React, { useEffect, useState } from 'react';
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
import { CommonComponentSidOwnerStep } from './steps/CommonPatternsStep.jsx';
import SetupGuide from './SetupGuide.jsx';
import HelpButton from './HelpButton.jsx';
import BranchSwitcher from './BranchSwitcher.jsx';
import { stateFromComponent } from './parseComponent.js';

const STEPS = ['Metadata', 'Links', 'Descriptions', 'Exposed APIs', 'Dependent APIs', 'Events', 'Compare Changes', 'Review & Save', 'Document History', 'SID Owner'];

// Which file each step edits: most steps build up `state` and only write it
// to the component's main YAML when Review & Save is used, while Links,
// Descriptions and Document History write straight to their own .md files
// under that component's Diagrams/ folder (see LinksStep.jsx /
// DescriptionsStep.jsx / DocumentHistoryStep.jsx) independently of the
// YAML/Save flow. Grouped here purely for the step pills' display below -
// doesn't affect step order or navigation.
const STEP_GROUPS = [
  { label: 'Component YAML', indices: [0, 3, 4, 5, 6, 7] },
  { label: 'Component Spec Document', indices: [1, 2, 8] },
];

// Unlike the two groups above, this step edits a repo-root-level file under
// docs/Common_Links/ (see CommonPatternsStep.jsx) rather than anything
// scoped to the component currently open - kept as its own group, rendered
// on its own row below Component Spec Document, so it reads as a separate
// concern rather than a pill squeezed into either existing box.
const COMMON_PATTERNS_GROUP = { label: 'Common architectural patterns', indices: [9] };

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
    refreshApiCatalog();
  }, [authUser]);

  const signOut = () => api.logout().then(() => setAuthUser(null)).catch(() => {});

  const startCreate = () => {
    setOriginal(null);
    setOriginalLocation(null);
    setState(blankState());
    api.nextId().then((r) => setState((s) => ({ ...s, id: r.id }))).catch(() => {});
    setMode('new');
    setStep(0);
  };

  const startEdit = ({ component, dirName, fileName }) => {
    setOriginal(component);
    setOriginalLocation({ dirName, fileName });
    setState(stateFromComponent(component));
    setMode('edit');
    setStep(0);
  };

  const backToStart = () => {
    setMode(null);
    setStep(0);
  };

  // Live preview shown persistently in the right-hand pane while a wizard is
  // in progress - read-only, purely a mirror of buildComponent(state,
  // original) (the same function ReviewStep uses for the real save/validate
  // calls), so it can never drift from what those actions would actually do.
  const previewYamlText = mode !== null
    ? yaml.dump(buildComponent(state, original), { sortKeys: false, lineWidth: -1, noArrayIndent: true })
    : '';

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
              {authUser ? <BranchSwitcher currentBranch={repoInfo.git.branch} /> : <code>{repoInfo.git.branch}</code>}
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
            <div className="rail-group" key={COMMON_PATTERNS_GROUP.label}>
              <div className="step-group-label">{COMMON_PATTERNS_GROUP.label}</div>
              {COMMON_PATTERNS_GROUP.indices.map((i, posIdx) => (
                <button
                  key={STEPS[i]}
                  className={`rail-item ${i === step ? 'active' : ''}`}
                  onClick={() => setStep(i)}
                >
                  <span className="n">{STEP_GROUPS.length + 1}.{posIdx + 1}</span> {STEPS[i]}
                </button>
              ))}
            </div>
          </div>

          <div className="main">
            {mode === 'edit' && (
              <div className="status-banner ok" style={{ marginBottom: 16 }}>
                Editing existing component {originalLocation?.dirName}. ID and name are locked to avoid orphaning its conformance profile/RI/diagram folders.
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
              <LinksStep dirName={originalLocation?.dirName} eTOMs={state.eTOMs} SIDs={state.SIDs} />
            )}
            {step === 2 && (
              <DescriptionsStep
                dirName={originalLocation?.dirName}
                eTOMs={state.eTOMs}
                functionalFrameworkFunctions={state.functionalFrameworkFunctions}
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
              <ReviewStep state={state} original={original} originalLocation={originalLocation} mode={mode} />
            )}
            {step === 8 && (
              <DocumentHistoryStep dirName={originalLocation?.dirName} />
            )}
            {step === 9 && <CommonComponentSidOwnerStep />}

            <div className="nav-buttons">
              <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</button>
              <button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={step === STEPS.length - 1}>Next</button>
            </div>
          </div>

          {step !== 6 && (
            <div className="yaml-pane">
              <div className="yaml-head"><b>Live YAML</b><span>read-only, updates as you edit</span></div>
              <pre className="yaml-live">{previewYamlText}</pre>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
