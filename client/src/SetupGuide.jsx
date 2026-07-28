import React, { useEffect, useState } from 'react';
import { api } from './api.js';

function StatusDot({ ok }) {
  return <span style={{ color: ok ? 'var(--ok)' : 'var(--danger)' }}>{ok ? '✓' : '✗'}</span>;
}

// Configures frameworksDir (the only remaining settable path here - see the
// read-only "Repo root" summary below instead for REPO_ROOT, which stopped
// being settable this way once per-branch worktrees replaced a single
// user-editable repo location).
function PathConfig({ label, fieldName, envVarName, placeholder, config, onSaved }) {
  const [value, setValue] = useState(config?.[fieldName] || '');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { ok, error? }

  useEffect(() => {
    setValue(config?.[fieldName] || '');
  }, [config?.[fieldName]]);

  const source = config?.frameworksDirSource;
  const envOverrideKey = 'frameworksDirEnvOverrideActive';

  const save = async () => {
    setSaving(true);
    setResult(null);
    try {
      const res = await api.setConfig({ [fieldName]: value.trim() });
      if (res.ok) {
        setResult({ ok: true });
        onSaved?.(res[fieldName]);
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
    <div className="field">
      <label>{label}</label>
      {!config && <div className="hint">Loading...</div>}
      {config && (
        <div className="card">
          <div>Currently using: <code>{config[fieldName]}</code></div>
          <div className="hint" style={{ marginTop: 4 }}>
            Source: {source === 'env' ? `${envVarName} environment variable` : source === 'config' ? 'saved setting' : 'built-in default'}
          </div>
          {config[envOverrideKey] && (
            <div className="hint" style={{ marginTop: 4, color: 'var(--danger)' }}>
              The {envVarName} environment variable is set and always takes priority over this setting.
              Unset it to let the value below take effect.
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              style={{ flex: 1 }}
            />
            <button className="save" onClick={save} disabled={saving || !value.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          {result?.ok && (
            <div className="hint" style={{ marginTop: 6, color: 'var(--ok)' }}>
              Saved to {config.configPath}. Restart the app for this to take effect.
            </div>
          )}
          {result?.error && (
            <div className="hint" style={{ marginTop: 6, color: 'var(--danger)' }}>{result.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

function FrameworksRegenerate({ onRegenerated }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null); // { ok, error?, output?, pythonCommand?, frameworksVersions? }

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await api.regenerateFrameworks();
      setResult(res);
      if (res.ok) onRegenerated?.();
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" onClick={run} disabled={running}>
        {running ? 'Regenerating...' : 'Regenerate frameworks catalogs now'}
      </button>
      {result?.ok && (
        <div className="status-banner ok" style={{ marginTop: 8 }}>
          Done (via {result.pythonCommand}). eTOM: {result.frameworksVersions.etom.join(', ') || 'none'}
          {' · '}SID: {result.frameworksVersions.sid.join(', ') || 'none'}
          {' · '}Functional Framework: {result.frameworksVersions.functionalFramework.join(', ') || 'none'}
        </div>
      )}
      {result && !result.ok && (
        <div className="status-banner error" style={{ marginTop: 8 }}>{result.error}</div>
      )}
      {result?.output && (
        <pre className="yaml-preview" style={{ marginTop: 8 }}>{result.output}</pre>
      )}
    </div>
  );
}

// Every branch currently checked out as its own independent working folder
// (see BranchSwitcher.jsx) - the main checkout can't be removed here since
// it isn't a disposable branch worktree the way the others are.
function WorktreesList() {
  const [data, setData] = useState(null); // { worktrees, active, main }
  const [error, setError] = useState(null);
  const [busyPath, setBusyPath] = useState(null);

  const refresh = () => {
    setError(null);
    return api.gitWorktrees().then(setData).catch((err) => setError(err.message));
  };

  useEffect(() => { refresh(); }, []);

  const remove = (worktreePath) => {
    setBusyPath(worktreePath);
    api.removeWorktree(worktreePath)
      .then((r) => (r.ok ? refresh() : setError(r.error)))
      .catch((err) => setError(err.message))
      .finally(() => setBusyPath(null));
  };

  return (
    <div className="field">
      <label>Worktrees (branches checked out side-by-side)</label>
      {!data && !error && <div className="hint">Loading...</div>}
      {error && <div className="hint" style={{ color: 'var(--danger)' }}>{error}</div>}
      {data && (
        <table className="history-table">
          <thead>
            <tr><th>Branch</th><th>Path</th><th></th></tr>
          </thead>
          <tbody>
            {data.worktrees.map((w) => (
              <tr key={w.path}>
                <td>{w.branch || '(detached)'}{w.path === data.active ? ' — active' : ''}</td>
                <td><code style={{ fontSize: '0.8em' }}>{w.path}</code></td>
                <td className="remove-cell">
                  {w.path !== data.main && (
                    <button type="button" className="remove" onClick={() => remove(w.path)} disabled={busyPath === w.path}>
                      {busyPath === w.path ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function SetupGuide({ repoInfo, onFrameworksRegenerated }) {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {});
  }, []);

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Setup</h3>

      <div className="field">
        <label>Current configuration</label>
        {!repoInfo && <div className="hint">Loading...</div>}
        {repoInfo && (
          <div className="card">
            <div>Repo root: <code>{repoInfo.repoRoot}</code></div>
            <div className="hint" style={{ marginTop: 4 }}>
              {repoInfo.repoRootSource === 'worktree'
                ? "This session's active worktree - use \"Work on a different branch\" above to switch, or the list below."
                : repoInfo.repoRootSource === 'session-workspace'
                  ? "This session's own workspace clone."
                  : 'Set via the REPO_ROOT environment variable (or the saved config file) - restart the server to change it.'}
            </div>
            <div><StatusDot ok={repoInfo.specificationsDirExists} /> specifications/ folder found</div>
            <div><StatusDot ok={repoInfo.schemaExists} /> ci/component.schema.json found</div>
            <div><StatusDot ok={repoInfo.apiIndexExists} /> apiIndex.json found</div>
            {repoInfo.git?.remote && (
              <div>Git: {repoInfo.git.remoteUrl ? <a href={repoInfo.git.remoteUrl} target="_blank" rel="noreferrer">{repoInfo.git.remote}</a> : repoInfo.git.remote}{repoInfo.git.branch ? ` @ ${repoInfo.git.branch}` : ''}</div>
            )}
            <div style={{ marginTop: 8 }}>Frameworks dir: <code>{repoInfo.frameworksDir}</code></div>
            <div><StatusDot ok={repoInfo.frameworksDirExists} /> directory found</div>
            <div><StatusDot ok={repoInfo.frameworksVersions?.etom?.length} /> eTOM versions: {repoInfo.frameworksVersions?.etom?.join(', ') || 'none'}</div>
            <div><StatusDot ok={repoInfo.frameworksVersions?.sid?.length} /> SID versions: {repoInfo.frameworksVersions?.sid?.join(', ') || 'none'}</div>
            <div><StatusDot ok={repoInfo.frameworksVersions?.functionalFramework?.length} /> Functional Framework versions: {repoInfo.frameworksVersions?.functionalFramework?.join(', ') || 'none'}</div>
          </div>
        )}
      </div>

      <WorktreesList />

      <PathConfig
        label="Frameworks directory configuration"
        fieldName="frameworksDir"
        envVarName="FRAMEWORKS_DIR"
        placeholder="C:\path\to\frameworks"
        config={config}
        onSaved={(frameworksDir) => setConfig((c) => ({ ...c, frameworksDir, frameworksDirSource: 'config' }))}
      />

      <div className="field">
        <label>Directory layout</label>
        <p className="hint">
          The repo checkout and the frameworks data directory are configured completely independently -
          each has its own env var, saved setting, and default (see the two cards above) - and can live
          anywhere on disk, including under unrelated parent folders.
        </p>
        <pre className="yaml-preview">{`TMForum-ODA-Component-Specification-v1.1.0/   <- REPO_ROOT (the spec repo checkout)

frameworks/                                    <- FRAMEWORKS_DIR: eTOM / SID / Functional Framework data ONLY
  GB921_Business_Process_Framework_Processes_Excel_v26.0.xlsx
  GB922_Information_Framework_SID_Excel_v26.0.xlsx
  GB1033F_Functional_Framework_Excel_Format_v26.0.xlsx
  etom_v26.0.json               <- generated; version comes from the xlsx filename
  sid_v26.0.json                <- multiple versions can coexist (etom_v27.0.json, ...)
  functionalFramework_v26.0.json <- the server serves the latest version by default`}</pre>
        <p className="hint">
          The converter script itself (<code>parse_reference_data.py</code>) lives in this app's own
          <code>scripts/</code> folder, not in frameworks/ - that directory should only ever hold the
          source spreadsheets and the generated JSON.
        </p>
      </div>

      <div className="field">
        <label>Environment variables</label>
        <ul className="errors-list">
          <li><code>REPO_ROOT</code> - path to the component spec repo checkout. Precedence: this env var, then the saved config file, then the built-in default. Not settable from this page - see the "Repo root" line above, and "Work on a different branch" for switching branches/worktrees within it.</li>
          <li><code>FRAMEWORKS_DIR</code> - path to the frameworks data directory. Precedence: this env var, then the saved setting from the "Frameworks directory configuration" card above, then a bundled <code>frameworks</code> folder shipped next to the app (if present), then the legacy default next to <code>REPO_ROOT</code>.</li>
          <li><code>PORT</code> - server port (default 4310).</li>
        </ul>
      </div>

      <div className="field">
        <label>Regenerating the frameworks catalogs</label>
        <p className="hint">
          Drop a new release's spreadsheet into frameworks/ alongside the old one (don't need to remove it)
          and re-run the converter - every GB921*/GB922*/GB1033* file present gets its own versioned JSON,
          named from the version in its filename (e.g. "..._v27.0.xlsx" -&gt; "etom_v27.0.json"). The server
          always serves the latest version by default. If a spreadsheet's filename has no parseable version,
          conversion still succeeds - the output is named with an underscore in place of the version
          (e.g. "etom__.json") instead of failing.
        </p>
        <pre className="yaml-preview">{`python scripts/parse_reference_data.py <frameworks-dir>
# or, from inside the frameworks directory itself:
cd frameworks && python ../scripts/parse_reference_data.py`}</pre>
        <p className="hint">Or just use the button below - it runs the same script against this server's configured frameworks directory.</p>
        <FrameworksRegenerate onRegenerated={onFrameworksRegenerated} />
      </div>

      <div className="field">
        <label>Running the app (development)</label>
        <p className="hint">Two dev servers, defined in <code>.claude/launch.json</code>:</p>
        <ul className="errors-list">
          <li><code>doc-spec-studio-server</code> - Express API, port 4310, restarts automatically on file changes (<code>node --watch</code>).</li>
          <li><code>doc-spec-studio-client</code> - Vite dev server, port 4320, proxies <code>/api</code> to the server.</li>
        </ul>
      </div>

      <div className="field">
        <label>Packaging a standalone Windows exe</label>
        <p className="hint">
          Bundles the server and built client into one self-contained process - double-click and it
          opens your browser to the app, no Node install or dev servers required.
        </p>
        <pre className="yaml-preview">{`npm install
npm run dist
# produces dist/ComponentDocSpecStudio.exe + dist/public/ + dist/scripts/ + dist/frameworks/`}</pre>
        <p className="hint">
          Distribute <code>ComponentDocSpecStudio.exe</code> together with its sibling <code>public/</code>
          (the built UI), <code>scripts/</code> (frameworks converter) and <code>frameworks/</code>
          (pre-generated eTOM/SID/Functional Framework catalog JSON, so the app works out of the box with
          no setup) folders - all four must sit in the same directory. The source <code>.xlsx</code>
          spreadsheets are never bundled (they're large and license-bearing) - only the converted JSON
          catalogs are. REPO_ROOT and FRAMEWORKS_DIR still apply the same way as in dev (env vars, the saved
          setting from the Setup page, or the bundled <code>frameworks/</code> folder as the default).
        </p>
      </div>

      <div className="field">
        <label>Building an installable Windows exe</label>
        <p className="hint">
          A real installer - Start Menu shortcut, registered in Add/Remove Programs with a working
          uninstaller - rather than the portable exe above. No admin rights needed; installs per-user to
          %LOCALAPPDATA%\Programs\ComponentDocSpecStudio.
        </p>
        <pre className="yaml-preview">{`npm run dist
cp dist/ComponentDocSpecStudio.exe installer/payload/
powershell -Command "Compress-Archive -Path dist/public/* -DestinationPath installer/payload/public.zip -Force"
powershell -Command "Compress-Archive -Path dist/scripts/* -DestinationPath installer/payload/scripts.zip -Force"
powershell -Command "Compress-Archive -Path dist/frameworks/* -DestinationPath installer/payload/frameworks.zip -Force"
cd installer
npx pkg . --targets node22-win-x64 --output ../dist/ComponentDocSpecStudio-Setup.exe
# produces dist/ComponentDocSpecStudio-Setup.exe - just run it`}</pre>
        <p className="hint">
          The setup exe embeds the app + install/uninstall PowerShell scripts, unpacks them to a temp
          folder, and runs the installer. <code>frameworks.zip</code> is optional - only include it if
          <code>dist/frameworks/</code> has catalog JSON to bundle. To uninstall: Settings → Apps →
          "ODA Component Doc Specification Studio" → Uninstall (or run <code>uninstall.ps1</code> from the
          install folder directly).
        </p>
      </div>
    </div>
  );
}
