import express from 'express';
import session from 'express-session';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const execFileAsync = promisify(execFile);

const app = express();
// ALLOWED_ORIGIN locks CORS down to the deployed origin in hosted environments;
// left unset, cors() falls back to reflecting any origin (fine for local dev).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN } : undefined));
app.use(express.json({ limit: '2mb' }));

// Ties each request to a signed-in GitHub identity. SESSION_SECRET must be
// set to a real secret in any hosted deployment - the fallback below only
// exists so local dev works without extra setup.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set - using an insecure development-only default. Set a real SESSION_SECRET before deploying.');
}
app.use(session({
  secret: SESSION_SECRET || 'dev-only-insecure-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
}));

// GitHub OAuth (Authorization Code flow) - see /auth/github and
// /auth/github/callback below. Requires an OAuth App registered at
// https://github.com/settings/developers with its callback URL set to
// GITHUB_CALLBACK_URL (or the default below, for local dev).
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL
  || `http://localhost:${process.env.PORT || 4310}/auth/github/callback`;

app.get('/auth/github', (req, res) => {
  if (!GITHUB_CLIENT_ID) {
    return res.status(500).send('GitHub OAuth is not configured (GITHUB_CLIENT_ID is not set on the server).');
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_CALLBACK_URL,
    // "repo" is required to open PRs against the spec repo in a later stage;
    // "read:user" is just for the display name/avatar shown in the header.
    scope: 'repo read:user',
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get('/auth/github/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!state || state !== req.session.oauthState) {
    return res.status(400).send('Invalid or expired OAuth state - please try signing in again.');
  }
  delete req.session.oauthState;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_CALLBACK_URL,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) {
      return res.status(400).send(`GitHub sign-in failed: ${tokenJson.error_description || tokenJson.error || 'no access token returned'}.`);
    }
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}`, 'User-Agent': 'component-doc-web-studio' },
    });
    const profile = await userRes.json();
    // accessToken stays server-side only (session store) - never sent to the
    // client - so a later stage can use it to open PRs as this user.
    req.session.user = {
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatar_url,
      accessToken: tokenJson.access_token,
    };
    res.redirect('/');
  } catch (err) {
    res.status(500).send(`GitHub sign-in failed: ${err.message}`);
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  const { user } = req.session;
  res.json({ user: user ? { login: user.login, name: user.name, avatarUrl: user.avatarUrl } : null });
});

// Every other /api/* route requires a signed-in session - /api/health and
// /api/me (above) are the only ones a logged-out client can call.
const PUBLIC_API_PATHS = new Set(['/api/health', '/api/me']);
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || PUBLIC_API_PATHS.has(req.path)) return next();
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Not signed in. Sign in with GitHub first.' });
  next();
});

// User-level settings (currently just repoRoot), independent of any single
// install/checkout so they survive reinstalling or moving the app itself.
// The REPO_ROOT env var always wins over this file when set, matching the
// existing env-var-overrides-default precedence.
const CONFIG_PATH = path.join(os.homedir(), '.component-doc-specification-studio', 'config.json');

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfigFile(partial) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const next = { ...readConfigFile(), ...partial };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

const savedConfig = readConfigFile();

// Fallback root of the Component Specification repo, used only when
// SPEC_REPO_URL isn't configured (see ensureWorkspace below) - i.e. the
// Stage 1/2 single-shared-checkout behavior, kept for simple/local
// deployments that don't need per-user workspaces. Precedence: REPO_ROOT env
// var > saved config (legacy Setup Instructions tab) > the v1.1.0 checkout
// the original author had attached.
const REPO_ROOT = process.env.REPO_ROOT
  || savedConfig.repoRoot
  || 'C:\\Users\\HugoVaughan\\ClaudeCode\\TMForum-ODA-Component-Specification-v1.1.0';

const REPO_ROOT_SOURCE = process.env.REPO_ROOT ? 'env' : (savedConfig.repoRoot ? 'config' : 'default');

// Every route resolves its own repo root through this instead of a module
// constant, so each signed-in user's requests operate on their own workspace
// clone (see ensureWorkspace) rather than one shared checkout.
function resolveRepoRoot(req) {
  return req.workspaceDir || REPO_ROOT;
}

const specificationsDir = (root) => path.join(root, 'specifications');
const schemaPath = (root) => path.join(root, 'ci', 'component.schema.json');
const apiIndexPath = (root) => path.join(root, 'apiIndex.json');
// Cross-component "common architectural patterns" link tables - unlike the
// per-component Diagrams/*.md files below, these two live once at the repo
// root (docs/Common_Links/) and consolidate links that span multiple
// components' own diagrams (see registerCommonLinksRoutes further down).
const commonLinksDir = (root) => path.join(root, 'docs', 'Common_Links');

// Each signed-in user gets their own throwaway clone of the spec repo
// (rather than everyone sharing REPO_ROOT above), so concurrent users never
// see or overwrite each other's in-progress edits. Cloning only happens when
// SPEC_REPO_URL is set - unset, the app behaves exactly as Stage 1/2 did.
const SPEC_REPO_URL = process.env.SPEC_REPO_URL;
const SPEC_REPO_BRANCH = process.env.SPEC_REPO_BRANCH || 'main';
const SESSIONS_ROOT = path.join(os.tmpdir(), 'oda-web-studio-sessions');
// Dedupes concurrent requests from the same fresh session that would
// otherwise all try to clone into the same directory at once.
const workspaceSetupPromises = new Map();

async function ensureWorkspace(req, res, next) {
  if (!SPEC_REPO_URL) return next();
  if (!req.path.startsWith('/api/') || PUBLIC_API_PATHS.has(req.path)) return next();

  if (req.session.workspaceDir && fs.existsSync(req.session.workspaceDir)) {
    req.workspaceDir = req.session.workspaceDir;
    fs.utimesSync(req.session.workspaceDir, new Date(), new Date()); // mark as recently used, for cleanupStaleWorkspaces
    return next();
  }

  const dir = path.join(SESSIONS_ROOT, req.sessionID);
  let setupPromise = workspaceSetupPromises.get(req.sessionID);
  if (!setupPromise) {
    setupPromise = (async () => {
      fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
      if (!fs.existsSync(dir)) {
        await execFileAsync('git', ['clone', '--branch', SPEC_REPO_BRANCH, SPEC_REPO_URL, dir]);
      }
      return dir;
    })().finally(() => workspaceSetupPromises.delete(req.sessionID));
    workspaceSetupPromises.set(req.sessionID, setupPromise);
  }

  try {
    req.workspaceDir = await setupPromise;
    req.session.workspaceDir = req.workspaceDir;
    next();
  } catch (err) {
    res.status(500).json({ ok: false, error: `Could not prepare your workspace: ${err.message}` });
  }
}

// Session workspace clones accumulate under SESSIONS_ROOT over time (a
// browser closed without signing out leaves its clone behind) - sweep any
// untouched for more than a day. ensureWorkspace above bumps a workspace's
// mtime on every use, so an active session's directory never looks stale.
const WORKSPACE_TTL_MS = 24 * 60 * 60 * 1000;
function cleanupStaleWorkspaces() {
  if (!fs.existsSync(SESSIONS_ROOT)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(SESSIONS_ROOT)) {
    const dir = path.join(SESSIONS_ROOT, entry);
    try {
      if (now - fs.statSync(dir).mtimeMs > WORKSPACE_TTL_MS) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // already gone, or a transient error - next sweep will retry
    }
  }
}
if (SPEC_REPO_URL) setInterval(cleanupStaleWorkspaces, 60 * 60 * 1000).unref();

app.use(ensureWorkspace);

// Reference taxonomy catalogs (eTOM/SID/Functional Framework), pre-converted
// from the official TMForum GB921/GB922/GB1033 Excel exports by
// scripts/parse_reference_data.py. This directory is configured fully
// independently of REPO_ROOT (env var > saved config, set via the Setup
// Instructions tab > a bundled "frameworks" folder shipped next to the
// packaged exe, if present > the legacy sibling-of-REPO_ROOT default) - the
// two no longer need to share a parent directory, so the repo checkout and
// the frameworks data can live anywhere on disk independently.
function resolveDefaultFrameworksDir() {
  const scriptDir = path.dirname(process.argv[1] || '.');
  const candidates = [
    process.pkg ? path.join(path.dirname(process.execPath), 'frameworks') : null,
    path.join(scriptDir, 'frameworks'),
    path.join(scriptDir, '..', 'frameworks'), // dev: index.js run from server/
    path.join(scriptDir, '..', '..', 'frameworks'), // dev: bundle.cjs run from server/dist/
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || path.join(path.dirname(REPO_ROOT), 'frameworks');
}

const REFERENCE_DATA_DIR = process.env.FRAMEWORKS_DIR
  || savedConfig.frameworksDir
  || resolveDefaultFrameworksDir();

const FRAMEWORKS_DIR_SOURCE = process.env.FRAMEWORKS_DIR ? 'env' : (savedConfig.frameworksDir ? 'config' : 'default');

// Frameworks catalogs are versioned in their filename (etom_v26.0.json,
// sid_v26.0.json, ...), produced by scripts/parse_reference_data.py -
// multiple versions of the same framework can sit side by side. A file whose
// version couldn't be parsed from its source spreadsheet is named with a
// literal underscore in place of the version (e.g. "etom__.json") and always
// sorts last, since it can't be compared against real version numbers.
function listVersionedFiles(baseName) {
  if (!fs.existsSync(REFERENCE_DATA_DIR)) return [];
  const re = new RegExp(`^${baseName}_(.+)\\.json$`);
  return fs.readdirSync(REFERENCE_DATA_DIR)
    .map((f) => {
      const m = f.match(re);
      return m ? { file: m[0], version: m[1] } : null;
    })
    .filter(Boolean);
}

function compareVersions(a, b) {
  if (a === '_' || b === '_') return a === b ? 0 : (a === '_' ? 1 : -1);
  const toParts = (v) => v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = toParts(a);
  const pb = toParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function listVersions(baseName) {
  return listVersionedFiles(baseName).map((f) => f.version).sort(compareVersions);
}

// Loads a specific version if given (falls back to the latest available if
// that exact version isn't found), otherwise the latest version.
function loadReferenceJson(baseName, version) {
  const files = listVersionedFiles(baseName);
  if (!files.length) return null;
  files.sort((x, y) => compareVersions(x.version, y.version));
  const chosen = (version && files.find((f) => f.version === version)) || files[files.length - 1];
  return JSON.parse(fs.readFileSync(path.join(REFERENCE_DATA_DIR, chosen.file), 'utf8'));
}

// js-yaml parses bare dates (e.g. `publicationDate: 2026-05-11`) into native
// Date objects. Flatten those back to plain YYYY-MM-DD strings so the client
// (and a subsequent save) sees plain JSON, matching how the files are hand-written.
function normalizeDates(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeDates(v)]));
  }
  return value;
}

// Human-friendly "owner/repo" form of a git remote URL, for display only.
function friendlyRemote(url) {
  if (!url) return null;
  const m = url.match(/[/:]([^/:]+\/[^/]+?)(\.git)?$/);
  return m ? m[1] : url;
}

function runGit(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function getGitInfo(root) {
  const remoteUrl = runGit(root, ['remote', 'get-url', 'origin']);
  const branch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return { remoteUrl, remote: friendlyRemote(remoteUrl), branch };
}

function loadSchema(root) {
  const raw = fs.readFileSync(schemaPath(root), 'utf8');
  return JSON.parse(raw);
}

function buildValidator(root) {
  const schema = loadSchema(root);
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

function listComponentDirs(root) {
  const dir = specificationsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^TMFC\d+-/.test(d.name))
    .map((d) => d.name);
}

function listComponentYamlFiles(root) {
  return listComponentDirs(root).map((dirName) => {
    const yamlPath = path.join(specificationsDir(root), dirName, `${dirName.split('-')[0]}-${dirName.split('-').slice(1).join('-')}.yaml`);
    return { dirName, yamlPath };
  }).filter((f) => fs.existsSync(f.yamlPath));
}

// repoRoot is no longer user-configurable here now that each signed-in user
// gets their own workspace clone automatically (see ensureWorkspace) -
// frameworksDir remains a shared, global setting since taxonomy catalogs
// aren't per-user data.
app.get('/api/config', (req, res) => {
  res.json({
    frameworksDir: REFERENCE_DATA_DIR,
    frameworksDirSource: FRAMEWORKS_DIR_SOURCE,
    frameworksDirEnvOverrideActive: Boolean(process.env.FRAMEWORKS_DIR),
    configPath: CONFIG_PATH,
  });
});

app.post('/api/config', (req, res) => {
  const { frameworksDir } = req.body;
  if (frameworksDir !== undefined && (typeof frameworksDir !== 'string' || !path.isAbsolute(frameworksDir))) {
    return res.status(400).json({ ok: false, error: 'frameworksDir must be an absolute path' });
  }
  if (frameworksDir === undefined) {
    return res.status(400).json({ ok: false, error: 'frameworksDir is required' });
  }
  try {
    writeConfigFile({ frameworksDir });
    res.json({
      ok: true,
      frameworksDir,
      frameworksDirEnvOverrideActive: Boolean(process.env.FRAMEWORKS_DIR),
      restartRequired: true,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Public (pre-auth) status check - reports the shared legacy REPO_ROOT/
// frameworks state, not any signed-in user's own workspace clone (that's
// only created once a user is signed in - see ensureWorkspace).
app.get('/api/health', (req, res) => {
  const root = resolveRepoRoot(req);
  res.json({
    ok: true,
    repoRoot: root,
    repoRootSource: req.workspaceDir ? 'session-workspace' : REPO_ROOT_SOURCE,
    specificationsDirExists: fs.existsSync(specificationsDir(root)),
    schemaExists: fs.existsSync(schemaPath(root)),
    apiIndexExists: fs.existsSync(apiIndexPath(root)),
    git: getGitInfo(root),
    frameworksDir: REFERENCE_DATA_DIR,
    frameworksDirSource: FRAMEWORKS_DIR_SOURCE,
    frameworksDirExists: fs.existsSync(REFERENCE_DATA_DIR),
    frameworksVersions: currentFrameworksVersions(),
  });
});

// Distinct functionalBlock values seen across existing components, so the
// wizard can offer a dropdown instead of free text.
app.get('/api/functional-blocks', (req, res) => {
  const root = resolveRepoRoot(req);
  const blocks = new Set();
  for (const { yamlPath } of listComponentYamlFiles(root)) {
    try {
      const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
      const fb = doc?.spec?.componentMetadata?.functionalBlock;
      if (fb) blocks.add(fb);
    } catch {
      // skip unreadable files
    }
  }
  res.json({ functionalBlocks: [...blocks].sort() });
});

// Cache of parsed swagger docs by URL, so repeatedly picking the same API in
// the wizard doesn't re-fetch/re-parse a multi-hundred-KB file every time.
const swaggerResourceCache = new Map();

const CANONICAL_VERB_ORDER = ['GET', 'GET /id', 'POST', 'PUT', 'PATCH', 'DELETE'];

// Turns a swagger/OpenAPI `paths` object into the {resourceName: [verbs]}
// shape used by componentMetadata resources, matching the convention seen in
// hand-written specs: a bare verb (GET, POST) is the collection-level
// operation; "GET /id" is the item-level GET, while PATCH/DELETE/PUT at item
// level keep their bare name since they're unambiguous there.
function parseSwaggerResources(doc) {
  const paths = doc?.paths || {};
  const byResource = new Map();

  for (const [rawPath, methods] of Object.entries(paths)) {
    const segments = rawPath.split('/').filter(Boolean);
    if (segments.length === 0) continue;
    const resourceName = segments[0];
    if (/^(hub|listener|events?)$/i.test(resourceName)) continue; // eventing plumbing, not a business resource

    let isItemPath;
    if (segments.length === 1) isItemPath = false;
    else if (segments.length === 2 && /^\{.*\}$/.test(segments[1])) isItemPath = true;
    else continue; // deeper nesting than resource/{id} - not modeled here

    if (!byResource.has(resourceName)) byResource.set(resourceName, new Set());
    const verbs = byResource.get(resourceName);
    for (const method of Object.keys(methods)) {
      const httpVerb = method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(httpVerb)) continue;
      verbs.add(isItemPath && httpVerb === 'GET' ? 'GET /id' : httpVerb);
    }
  }

  return [...byResource.entries()].map(([name, verbSet]) => ({
    name,
    operations: CANONICAL_VERB_ORDER.filter((v) => verbSet.has(v)),
  }));
}

// The event group name used in publishedEvents/subscribedEvents (e.g.
// "ProductCatalogManagement") is the swagger's own title with spaces
// stripped - e.g. TMF620's info.title "Product Catalog Management" - which
// is the authoritative source, rather than guessing from the catalog's
// display name (which usually has a trailing "API" to strip first).
function parseSwaggerEventName(doc) {
  const title = doc?.info?.title;
  return title ? title.replace(/\s+/g, '') : null;
}

// Event names available for publishedEvents/subscribedEvents `resources` -
// these come from the swagger's own `/listener/{eventName}` paths (the
// notification-callback convention TMF APIs use), e.g.
// "/listener/catalogCreateEvent" -> "catalogCreateEvent". This is the same
// name hand-written specs list under `resources`, so no guessing/renaming.
function parseSwaggerEvents(doc) {
  const paths = doc?.paths || {};
  const events = new Set();
  for (const rawPath of Object.keys(paths)) {
    const m = rawPath.match(/^\/listener\/([^/]+)$/i);
    if (m) events.add(m[1]);
  }
  return [...events].sort();
}

app.get('/api/api-resources', async (req, res) => {
  const swaggerUrl = req.query.swagger;
  if (!swaggerUrl || !/^https:\/\//.test(swaggerUrl)) {
    return res.status(400).json({ ok: false, error: 'A valid https swagger URL is required' });
  }
  if (swaggerResourceCache.has(swaggerUrl)) {
    return res.json({ ok: true, ...swaggerResourceCache.get(swaggerUrl) });
  }
  try {
    const response = await fetch(swaggerUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      return res.status(502).json({ ok: false, error: `Fetching swagger failed: HTTP ${response.status}` });
    }
    const doc = await response.json();
    const payload = {
      resources: parseSwaggerResources(doc),
      eventName: parseSwaggerEventName(doc),
      events: parseSwaggerEvents(doc),
    };
    swaggerResourceCache.set(swaggerUrl, payload);
    res.json({ ok: true, ...payload });
  } catch (err) {
    res.status(502).json({ ok: false, error: `Could not fetch/parse swagger: ${err.message}` });
  }
});

// TMF API catalog (id/version/name/swagger url) for the exposed/dependent API pickers.
// Excludes TMFnnnE-suffixed entries - every one of those in apiIndex.json is
// an "Asynchronous" event-driven variant of a regular API (confirmed by
// name, e.g. "TMF620E ... Product Catalog Management API Asynchronous"),
// and this app's exposed/dependent API pickers are for the synchronous REST
// APIs a component conforms to - async APIs aren't a valid pick there.
app.get('/api/apis', (req, res) => {
  const indexPath = apiIndexPath(resolveRepoRoot(req));
  if (!fs.existsSync(indexPath)) return res.json({ apis: [] });
  const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const apis = Object.entries(raw).map(([key, val]) => {
    const [id, versionRaw] = key.split('_v');
    return {
      key,
      id,
      version: versionRaw,
      name: val.name,
      swagger: val.swagger,
    };
  }).filter((a) => !/E$/i.test(a.id))
    .sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
  res.json({ apis });
});

// Taxonomy catalogs for the eTOM / Functional Framework / SID pickers.
// Optional ?version=v26.0 picks a specific release; omitted defaults to the
// latest version found on disk. /versions lists what's available.
app.get('/api/etom', (req, res) => {
  res.json(loadReferenceJson('etom', req.query.version) || { version: null, entries: [] });
});
app.get('/api/etom/versions', (req, res) => res.json({ versions: listVersions('etom') }));

app.get('/api/functional-framework', (req, res) => {
  res.json(loadReferenceJson('functionalFramework', req.query.version) || { version: null, entries: [] });
});
app.get('/api/functional-framework/versions', (req, res) => res.json({ versions: listVersions('functionalFramework') }));

app.get('/api/sid', (req, res) => {
  res.json(loadReferenceJson('sid', req.query.version) || { version: null, domains: [], abesByDomain: {}, besByDomainAbe: {} });
});
app.get('/api/sid/versions', (req, res) => res.json({ versions: listVersions('sid') }));

function currentFrameworksVersions() {
  return {
    etom: listVersions('etom'),
    sid: listVersions('sid'),
    functionalFramework: listVersions('functionalFramework'),
  };
}

// scripts/parse_reference_data.py lives in the app's own code, not in the
// frameworks data directory (which should only ever hold spreadsheets and
// generated JSON), so it has to be located relative to the running server
// the same way resolvePublicDir() locates the built client: a "scripts"
// folder shipped next to the packaged exe, next to this script, or the
// monorepo dev layout, whichever actually has the file.
function resolveParseScriptPath() {
  const scriptDir = path.dirname(process.argv[1] || '.');
  const candidates = [
    process.pkg ? path.join(path.dirname(process.execPath), 'scripts', 'parse_reference_data.py') : null,
    path.join(scriptDir, 'scripts', 'parse_reference_data.py'),
    path.join(scriptDir, '..', 'scripts', 'parse_reference_data.py'), // dev: index.js run from server/
    path.join(scriptDir, '..', '..', 'scripts', 'parse_reference_data.py'), // dev: bundle.cjs run from server/dist/
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// Re-runs scripts/parse_reference_data.py against whatever GB921*/GB922*/
// GB1033* spreadsheets currently sit in the frameworks directory, so a new
// release's spreadsheet can be picked up from the UI instead of a terminal.
// Tries `python` then `python3` on PATH, since which one exists varies by
// machine/OS.
app.post('/api/frameworks/regenerate', async (req, res) => {
  const scriptPath = resolveParseScriptPath();
  if (!scriptPath) {
    return res.status(404).json({ ok: false, error: 'Could not locate scripts/parse_reference_data.py alongside the running server.' });
  }

  for (const command of ['python', 'python3']) {
    try {
      const { stdout, stderr } = await execFileAsync(command, [scriptPath, REFERENCE_DATA_DIR], {
        cwd: REFERENCE_DATA_DIR,
        timeout: 120000,
      });
      return res.json({
        ok: true,
        pythonCommand: command,
        output: [stdout, stderr].filter(Boolean).join('\n').trim(),
        frameworksVersions: currentFrameworksVersions(),
      });
    } catch (err) {
      if (err.code === 'ENOENT') continue; // this command isn't on PATH - try the next one
      return res.status(500).json({
        ok: false,
        pythonCommand: command,
        error: err.message,
        output: [err.stdout, err.stderr].filter(Boolean).join('\n').trim(),
      });
    }
  }
  res.status(500).json({ ok: false, error: 'Could not find a Python interpreter on PATH (tried "python" and "python3"). Install Python 3 and ensure it\'s on PATH (openpyxl is bundled with the app, so no separate pip install is needed).' });
});

// Lightweight list of existing components, for the "edit existing" picker.
app.get('/api/components', (req, res) => {
  const components = listComponentYamlFiles(resolveRepoRoot(req)).map(({ dirName, yamlPath }) => {
    try {
      const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
      const meta = doc?.spec?.componentMetadata || {};
      return {
        dirName,
        fileName: path.basename(yamlPath),
        id: meta.id,
        name: meta.name,
        version: meta.version,
        status: meta.status,
        functionalBlock: meta.functionalBlock,
      };
    } catch {
      return { dirName, fileName: path.basename(yamlPath), id: null, name: null };
    }
  }).filter((c) => c.id).sort((a, b) => a.id.localeCompare(b.id));
  res.json({ components });
});

// Link tables (specifications/<dirName>/Diagrams/<ID>_<suffix>.md) document
// hand-maintained relationships the YAML alone can't express, transcribed by
// hand from each component's original spec PDF: which eTOM activity
// connects to which SID ABE (eTOM_SID_Links - the "eTOM L2 - SID ABEs links"
// diagram), which eTOM activity connects directly to another eTOM activity
// (eTOM_eTOM_Links), and which SID ABE connects directly to another SID ABE
// (SID_SID_Links) - the latter two are links the same source diagram draws
// that don't fit eTOM_SID_Links' schema, split into their own files (see
// TMFC037_eTOM_eTOM_Links.md, TMFC035/TMFC039_SID_SID_Links.md for real
// examples). They're plain GFM tables with a title and free-text provenance
// notes before/after, so parsing has to locate the table by its separator
// row (`|---|---|...`) rather than by exact header wording, and cell values
// that contain a literal `|` (the "YAML ..." columns pack multiple
// pipe-delimited identifier parts into one cell) escape it as `\|` to avoid
// being read as a column break.
function linksFilePath(root, dirName, suffix) {
  const id = dirName.split('-')[0];
  return path.join(specificationsDir(root), dirName, 'Diagrams', `${id}_${suffix}.md`);
}

function splitTableRow(line) {
  const PLACEHOLDER = ' ';
  let trimmed = line.trim().replace(/\\\|/g, PLACEHOLDER);
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim().split(PLACEHOLDER).join('|'));
}

function parseLinksMarkdown(text, fields, defaultHeading) {
  const lines = text.split(/\r?\n/);
  const sepIdx = lines.findIndex((l) => /^\s*\|[\s:-]*-[\s:|-]*\|\s*$/.test(l));

  let heading = defaultHeading;
  let headingLineIdx = -1;
  const firstNonBlank = lines.findIndex((l) => l.trim() !== '');
  if (firstNonBlank !== -1 && lines[firstNonBlank].trim().startsWith('#')) {
    heading = lines[firstNonBlank].trim().replace(/^#+\s*/, '');
    headingLineIdx = firstNonBlank;
  }

  if (sepIdx === -1 || sepIdx === 0) {
    // No table found - treat the whole file (minus any heading line) as "before" notes.
    const notesBefore = lines.slice(headingLineIdx + 1).join('\n').trim();
    return { heading, notesBefore, notesAfter: '', links: [] };
  }

  const headerRowIdx = sepIdx - 1;
  const notesBefore = lines.slice(headingLineIdx + 1, headerRowIdx).join('\n').trim();

  let dataEndIdx = sepIdx + 1;
  while (dataEndIdx < lines.length && lines[dataEndIdx].trim().startsWith('|')) dataEndIdx++;

  const links = lines.slice(sepIdx + 1, dataEndIdx)
    .map((line) => splitTableRow(line))
    .filter((cells) => cells.some((c) => c !== ''))
    .map((cells) => Object.fromEntries(fields.map((f, i) => [f, cells[i] || ''])));

  const notesAfter = lines.slice(dataEndIdx).join('\n').trim();

  return { heading, notesBefore, notesAfter, links };
}

function renderLinksMarkdown({ heading, notesBefore, notesAfter, links }, columns, fields) {
  const escapeCell = (v) => (v || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const parts = [`# ${heading}`, ''];
  if (notesBefore?.trim()) parts.push(notesBefore.trim(), '');
  parts.push(`| ${columns.join(' | ')} |`);
  parts.push(`|${columns.map(() => '---').join('|')}|`);
  for (const row of links) {
    parts.push(`| ${fields.map((f) => escapeCell(row[f])).join(' | ')} |`);
  }
  if (notesAfter?.trim()) parts.push('', notesAfter.trim());
  parts.push('');
  return parts.join('\n');
}

// Column schema matched to the real checked-in files (not invented):
// eTOM_eTOM_Links has no YAML cross-reference columns in any real example
// (just the two activity labels + Direction); SID_SID_Links has the same
// 5-column shape as eTOM_SID_Links but source/target are both SID ABEs.
// "Direction" in the eTOM_eTOM/SID_SID tables is free text in practice
// ("bidirectional" or "one-directional (Source -> Target)"), unlike
// eTOM_SID_Links' fixed three-value Direction - so only eTOM_SID_Links'
// Direction is a constrained dropdown; the other two are plain text fields.
const LINK_TYPES = {
  etomSid: {
    suffix: 'eTOM_SID_Links',
    route: 'links',
    columns: ['eTOM activity', 'SID ABE', 'Direction', 'YAML eTOM', 'YAML SID'],
    fields: ['etomActivity', 'sidABE', 'direction', 'yamlETOM', 'yamlSID'],
    defaultHeading: (id) => `${id} eTOM–SID Links`,
  },
  etomEtom: {
    suffix: 'eTOM_eTOM_Links',
    route: 'etom-etom-links',
    columns: ['Source eTOM activity', 'Target eTOM activity', 'Direction'],
    fields: ['sourceActivity', 'targetActivity', 'direction'],
    defaultHeading: (id) => `${id} eTOM–eTOM Links`,
  },
  sidSid: {
    suffix: 'SID_SID_Links',
    route: 'sid-sid-links',
    columns: ['Source SID ABE', 'Target SID ABE', 'Direction', 'YAML source', 'YAML target'],
    fields: ['sourceSID', 'targetSID', 'direction', 'yamlSource', 'yamlTarget'],
    defaultHeading: (id) => `${id} SID–SID Links`,
  },
};

function registerLinksRoutes(type) {
  app.get(`/api/component/:dirName/${type.route}`, (req, res) => {
    const { dirName } = req.params;
    if (!/^[\w.\-]+$/.test(dirName)) {
      return res.status(400).json({ ok: false, error: 'Invalid dirName' });
    }
    const id = dirName.split('-')[0];
    const filePath = linksFilePath(resolveRepoRoot(req), dirName, type.suffix);
    const defaultHeading = type.defaultHeading(id);
    if (!fs.existsSync(filePath)) {
      return res.json({ ok: true, exists: false, heading: defaultHeading, notesBefore: '', notesAfter: '', links: [] });
    }
    try {
      const parsed = parseLinksMarkdown(fs.readFileSync(filePath, 'utf8'), type.fields, defaultHeading);
      res.json({ ok: true, exists: true, ...parsed });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post(`/api/component/:dirName/${type.route}`, (req, res) => {
    const { dirName } = req.params;
    if (!/^[\w.\-]+$/.test(dirName)) {
      return res.status(400).json({ ok: false, error: 'Invalid dirName' });
    }
    const { heading, notesBefore, notesAfter, links } = req.body;
    if (!Array.isArray(links)) {
      return res.status(400).json({ ok: false, error: 'links must be an array' });
    }
    try {
      const id = dirName.split('-')[0];
      const filePath = linksFilePath(resolveRepoRoot(req), dirName, type.suffix);
      const defaultHeading = type.defaultHeading(id);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, renderLinksMarkdown({ heading: heading || defaultHeading, notesBefore, notesAfter, links }, type.columns, type.fields), 'utf8');
      res.json({ ok: true, path: filePath });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}

Object.values(LINK_TYPES).forEach(registerLinksRoutes);

// Consolidated, repo-root-level link tables under docs/Common_Links/ - same
// "GFM table + free-text notes" shape as the per-component link files above,
// so parsing/rendering is reused, but there's exactly one file per type
// (not one per component). A cell referencing a pre-v26.0 SID version is
// flagged as a warning client-side (see CommonPatternsStep.jsx) rather than
// enforced here - older versions are still legitimate, so the server accepts
// whatever the client sends.
const COMMON_LINK_TYPES = {
  commonSidSid: {
    route: 'common-sid-sid-links',
    fileName: 'Common_SID_SID_Links.md',
    columns: ['Direction', 'YAML source', 'YAML target'],
    fields: ['direction', 'yamlSource', 'yamlTarget'],
    defaultHeading: 'Common SID–SID Links',
  },
  commonComponentSidOwner: {
    route: 'common-component-sid-owner-links',
    fileName: 'Common_Component_SID_owner_Links.md',
    columns: ['Depicted under component', 'SID element as present in the YAML file'],
    fields: ['component', 'sidElement'],
    defaultHeading: 'Common Component–SID Links',
  },
};

function registerCommonLinksRoutes(type) {
  app.get(`/api/${type.route}`, (req, res) => {
    const filePath = path.join(commonLinksDir(resolveRepoRoot(req)), type.fileName);
    if (!fs.existsSync(filePath)) {
      return res.json({ ok: true, exists: false, heading: type.defaultHeading, notesBefore: '', notesAfter: '', links: [] });
    }
    try {
      const parsed = parseLinksMarkdown(fs.readFileSync(filePath, 'utf8'), type.fields, type.defaultHeading);
      res.json({ ok: true, exists: true, ...parsed });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post(`/api/${type.route}`, (req, res) => {
    const { heading, notesBefore, notesAfter, links } = req.body;
    if (!Array.isArray(links)) {
      return res.status(400).json({ ok: false, error: 'links must be an array' });
    }
    try {
      const filePath = path.join(commonLinksDir(resolveRepoRoot(req)), type.fileName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        renderLinksMarkdown({ heading: heading || type.defaultHeading, notesBefore, notesAfter, links }, type.columns, type.fields),
        'utf8',
      );
      res.json({ ok: true, path: filePath });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}

Object.values(COMMON_LINK_TYPES).forEach(registerCommonLinksRoutes);

// Description lookup files (Diagrams/<ID>_eTOM_Descriptions.md,
// Diagrams/<ID>_FF_Descriptions.md) hold prose the YAML has no room for:
// each eTOM activity's, or each Functional Framework function's, own
// descriptive text (and, for FF, its two Aggregate Function Level columns),
// transcribed by hand from the component's original published .docx/.pdf -
// that text lives in the eTOM/Functional Framework standards themselves,
// not in this component's own YAML (see the component-specification-markdown
// skill's references/diagrams.md, "eTOM/Functional Framework descriptions").
// Same heading + free-text source note + GFM table shape as the link tables
// above (real examples: TMFC005_eTOM_Descriptions.md/_FF_Descriptions.md),
// so this reuses linksFilePath/parseLinksMarkdown/renderLinksMarkdown/
// registerLinksRoutes as-is - "links" in those names is a misnomer once
// shared like this, but they were already fully generic (column/field
// arrays of any shape), so there's nothing description-specific to add.
const DESCRIPTION_TYPES = {
  etom: {
    suffix: 'eTOM_Descriptions',
    route: 'etom-descriptions',
    columns: ['Identifier', 'Description'],
    fields: ['identifier', 'description'],
    defaultHeading: (id) => `${id} eTOM Business Activity Descriptions`,
  },
  ff: {
    suffix: 'FF_Descriptions',
    route: 'ff-descriptions',
    columns: ['Function ID', 'Function Description', 'Aggregate Function Level 1', 'Aggregate Function Level 2'],
    fields: ['functionId', 'functionDescription', 'aggregateLevel1', 'aggregateLevel2'],
    defaultHeading: (id) => `${id} Functional Framework Function Descriptions`,
  },
};

Object.values(DESCRIPTION_TYPES).forEach(registerLinksRoutes);

// The <ID>_<Name>_Supplement.md file (specifications/<dirName>/Diagrams/) is
// the hand-curated tail of a component's specification - Jira references,
// further resources, and the administrative appendix (document/release
// history, acknowledgements). The component-specification-markdown skill
// treats this file as a one-time-seeded, hand-maintained input it only ever
// reads (never regenerates), so editing it here is safe and matches how the
// rest of the toolchain already treats it.
//
// The filename doesn't follow a clean mechanical rule in practice (e.g.
// "and" is sometimes kept lowercase and un-split, a few components' files
// are named shorter than their full componentMetadata.name), so an existing
// file is located by pattern rather than by deriving its exact name -
// that derivation is only used as a default when creating a brand new one.
const SUPPLEMENT_TEMPLATE_BODY = `### 5.2. Jira References

#### 5.2.1. eTOM
- <https://projects.tmforum.org/jira/browse/XXX-000> short description of the issue

#### 5.2.3. Functional Framework
- <https://projects.tmforum.org/jira/browse/XXX-000> short description of the issue

#### 5.2.4. API
- TMFxxx - API Name: short description of the issue
  - <https://projects.tmforum.org/jira/browse/XXX-000>

### 5.3. Further resources

This component is involved in the following use cases described in <name and reference of guide>.

## 6. Administrative Appendix

### 6.1. Document History

#### 6.1.1. Version History

| Version Number | Date | Modified by | Description of changes |
|---|---|---|---|
| 1.0.0 | DD-Mon-YYYY | Author Name | Initial publication |

#### 6.1.2. Release History

| Release Status | Date Modified | Modified by | Description of changes |
|---|---|---|---|
| Pre-production | DD-Mon-YYYY | Author Name | Initial release |

### 6.2. Acknowledgements

This document was prepared by the members of the TM Forum ODA Components & Canvas team.

| Team Member | Company | Role |
|---|---|---|
| Author Name | Company | Editor |
`;

// The Supplement file's structure beyond its free-text sections (headings,
// the acknowledgements intro sentence, table column headers) is preserved
// verbatim rather than parsed strictly, since real files' exact wording
// varies (see the parser below) - only the pieces explicitly editable from
// the Document History tab (Jira references body, further resources body,
// the last few history-table rows, and the acknowledgements rows) are ever
// replaced. Everything else round-trips unchanged.
const DEFAULT_HEADINGS = {
  jira: '### 5.2. Jira References',
  further: '### 5.3. Further resources',
  appendix: '## 6. Administrative Appendix',
  docHistory: '### 6.1. Document History',
  versionHistory: '#### 6.1.1. Version History',
  releaseHistory: '#### 6.1.2. Release History',
  acknowledgements: '### 6.2. Acknowledgements',
};
const DEFAULT_ACK_INTRO = 'This document was prepared by the members of the TM Forum ODA Components & Canvas team.';
const DEFAULT_VERSION_COLUMNS = ['Version Number', 'Date', 'Modified by', 'Description of changes'];
const DEFAULT_RELEASE_COLUMNS = ['Release Status', 'Date Modified', 'Modified by', 'Description of changes'];
const DEFAULT_ACK_COLUMNS = ['Team Member', 'Company', 'Role'];

function isTableSeparatorRow(line) {
  const t = line.trim();
  return t.includes('-') && /^\|?[\s:|-]+\|?$/.test(t);
}

// Parses a GFM table starting at/after `idx` (skipping leading blank lines).
// Returns { columns: [], rows: [[cell,...]], nextIdx } - columns/rows empty
// and nextIdx === idx if no table is found there (e.g. a heading with no
// table under it at all).
function parseTableBlock(lines, idx) {
  let i = idx;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length || !lines[i].trim().startsWith('|') || !isTableSeparatorRow(lines[i + 1] || '')) {
    return { columns: [], rows: [], nextIdx: idx };
  }
  const columns = splitTableRow(lines[i]);
  let dataEndIdx = i + 2;
  while (dataEndIdx < lines.length && lines[dataEndIdx].trim().startsWith('|')) dataEndIdx++;
  const rows = lines.slice(i + 2, dataEndIdx).map(splitTableRow);
  return { columns, rows, nextIdx: dataEndIdx };
}

// Scans forward from `from` for a table (header + separator row) without a
// heading immediately in front of it - used for the acknowledgements table,
// which sits after a free-text intro sentence rather than right after its
// heading.
function findTableStart(lines, from) {
  for (let j = from; j < lines.length; j++) {
    if (lines[j].trim().startsWith('|') && isTableSeparatorRow(lines[j + 1] || '')) return j;
  }
  return -1;
}

function findHeadingIndex(lines, regex, from) {
  for (let j = from; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t.startsWith('#') && regex.test(t)) return j;
  }
  return -1;
}

function joinTrim(lines, from, to) {
  if (from === -1) return '';
  return lines.slice(from, to === -1 ? lines.length : to).join('\n').trim();
}

function stripSupplementFrontMatter(text) {
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4);
    if (end !== -1) return text.slice(end + 5);
  }
  return text;
}

function parseSupplementBody(bodyText) {
  const lines = bodyText.split(/\r?\n/);

  const jiraIdx = findHeadingIndex(lines, /jira reference/i, 0);
  const furtherIdx = findHeadingIndex(lines, /further resource/i, jiraIdx === -1 ? 0 : jiraIdx + 1);
  const appendixIdx = findHeadingIndex(lines, /administrative appendix/i, furtherIdx === -1 ? 0 : furtherIdx + 1);
  const docHistoryIdx = findHeadingIndex(lines, /document history/i, appendixIdx === -1 ? 0 : appendixIdx + 1);
  const versionHistoryIdx = findHeadingIndex(lines, /version history/i, docHistoryIdx === -1 ? 0 : docHistoryIdx + 1);
  const releaseHistoryIdx = findHeadingIndex(lines, /release history/i, versionHistoryIdx === -1 ? 0 : versionHistoryIdx + 1);
  const ackIdx = findHeadingIndex(lines, /acknowledge/i, releaseHistoryIdx === -1 ? 0 : releaseHistoryIdx + 1);

  const jiraBody = joinTrim(lines, jiraIdx === -1 ? -1 : jiraIdx + 1, furtherIdx !== -1 ? furtherIdx : (appendixIdx !== -1 ? appendixIdx : lines.length));
  const furtherBody = joinTrim(lines, furtherIdx === -1 ? -1 : furtherIdx + 1, appendixIdx !== -1 ? appendixIdx : lines.length);

  const versionTable = versionHistoryIdx !== -1 ? parseTableBlock(lines, versionHistoryIdx + 1) : { columns: [], rows: [], nextIdx: -1 };
  const releaseTable = releaseHistoryIdx !== -1 ? parseTableBlock(lines, releaseHistoryIdx + 1) : { columns: [], rows: [], nextIdx: -1 };

  let ackIntro = '';
  let ackTable = { columns: [], rows: [], nextIdx: -1 };
  if (ackIdx !== -1) {
    const tableStart = findTableStart(lines, ackIdx + 1);
    if (tableStart !== -1) {
      ackIntro = joinTrim(lines, ackIdx + 1, tableStart);
      ackTable = parseTableBlock(lines, tableStart);
    } else {
      ackIntro = joinTrim(lines, ackIdx + 1, lines.length);
    }
  }

  const trailing = ackTable.nextIdx !== -1 ? joinTrim(lines, ackTable.nextIdx, lines.length) : '';

  return {
    jiraHeading: jiraIdx !== -1 ? lines[jiraIdx].trim() : DEFAULT_HEADINGS.jira,
    jiraBody,
    furtherHeading: furtherIdx !== -1 ? lines[furtherIdx].trim() : DEFAULT_HEADINGS.further,
    furtherBody,
    appendixHeading: appendixIdx !== -1 ? lines[appendixIdx].trim() : DEFAULT_HEADINGS.appendix,
    docHistoryHeading: docHistoryIdx !== -1 ? lines[docHistoryIdx].trim() : DEFAULT_HEADINGS.docHistory,
    versionHistoryHeading: versionHistoryIdx !== -1 ? lines[versionHistoryIdx].trim() : DEFAULT_HEADINGS.versionHistory,
    versionHistory: { columns: versionTable.columns.length ? versionTable.columns : DEFAULT_VERSION_COLUMNS, rows: versionTable.rows },
    releaseHistoryHeading: releaseHistoryIdx !== -1 ? lines[releaseHistoryIdx].trim() : DEFAULT_HEADINGS.releaseHistory,
    releaseHistory: { columns: releaseTable.columns.length ? releaseTable.columns : DEFAULT_RELEASE_COLUMNS, rows: releaseTable.rows },
    acknowledgementsHeading: ackIdx !== -1 ? lines[ackIdx].trim() : DEFAULT_HEADINGS.acknowledgements,
    ackIntro: ackIntro || DEFAULT_ACK_INTRO,
    acknowledgements: { columns: ackTable.columns.length ? ackTable.columns : DEFAULT_ACK_COLUMNS, rows: ackTable.rows },
    trailing,
  };
}

function renderSupplementTable(columns, rows) {
  const escapeCell = (v) => (v || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const parts = [`| ${columns.join(' | ')} |`, `|${columns.map(() => '---').join('|')}|`];
  for (const row of rows) {
    parts.push(`| ${columns.map((_, i) => escapeCell(row[i])).join(' | ')} |`);
  }
  return parts.join('\n');
}

function renderSupplementBody(parsed) {
  const parts = [
    parsed.jiraHeading, '', parsed.jiraBody, '',
    parsed.furtherHeading, '', parsed.furtherBody, '',
    parsed.appendixHeading, '',
    parsed.docHistoryHeading, '',
    parsed.versionHistoryHeading, '',
    renderSupplementTable(parsed.versionHistory.columns, parsed.versionHistory.rows), '',
    parsed.releaseHistoryHeading, '',
    renderSupplementTable(parsed.releaseHistory.columns, parsed.releaseHistory.rows), '',
    parsed.acknowledgementsHeading, '',
    parsed.ackIntro, '',
    renderSupplementTable(parsed.acknowledgements.columns, parsed.acknowledgements.rows),
  ];
  if (parsed.trailing) parts.push('', parsed.trailing);
  parts.push('');
  return parts.join('\n');
}

// The front matter (componentMetadata name/version) is always regenerated
// from the component's own YAML on every save, never taken from the client -
// this is what makes it "display only" from the app's point of view even
// though it's genuinely written into the file, matching the main
// specification .md's own `---`-delimited front matter convention (see the
// component-specification-markdown skill) so scripts/build_pdf.py's existing
// front-matter stripping logic extends to this file unchanged.
function renderSupplementMarkdown(parsed, meta) {
  const frontMatter = `---\nname: ${meta.name}\nversion: ${meta.version}\n---\n`;
  return `${frontMatter}\n${renderSupplementBody(parsed)}`;
}

function parseSupplementMarkdown(text) {
  return parseSupplementBody(stripSupplementFrontMatter(text));
}

function readComponentMeta(root, dirName) {
  const match = listComponentYamlFiles(root).find((f) => f.dirName === dirName);
  if (!match) return null;
  try {
    const doc = yaml.load(fs.readFileSync(match.yamlPath, 'utf8'));
    const meta = doc?.spec?.componentMetadata || {};
    return { name: meta.name || null, version: meta.version || null };
  } catch {
    return null;
  }
}

function pascalToUnderscore(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().replace(/\s+/g, '_');
}

function defaultSupplementFileName(root, dirName) {
  const id = dirName.split('-')[0];
  const match = listComponentYamlFiles(root).find((f) => f.dirName === dirName);
  let name = dirName.split('-').slice(1).join('-');
  if (match) {
    try {
      const doc = yaml.load(fs.readFileSync(match.yamlPath, 'utf8'));
      name = doc?.spec?.componentMetadata?.name || name;
    } catch {
      // fall through to the dirName-derived name
    }
  }
  return `${id}_${pascalToUnderscore(name)}_Supplement.md`;
}

// Finds the existing file by pattern (never by deriving its name - see
// comment above) so a legacy non-standard filename is still found rather
// than treated as missing.
function findSupplementFile(root, dirName) {
  const diagramsDir = path.join(specificationsDir(root), dirName, 'Diagrams');
  if (!fs.existsSync(diagramsDir)) return null;
  const match = fs.readdirSync(diagramsDir).find((f) => f.endsWith('_Supplement.md'));
  return match ? path.join(diagramsDir, match) : null;
}

app.get('/api/component/:dirName/supplement', (req, res) => {
  const { dirName } = req.params;
  if (!/^[\w.\-]+$/.test(dirName)) {
    return res.status(400).json({ ok: false, error: 'Invalid dirName' });
  }
  const root = resolveRepoRoot(req);
  const filePath = findSupplementFile(root, dirName);
  const meta = readComponentMeta(root, dirName);
  if (!filePath) {
    return res.json({ ok: true, exists: false, path: null, meta, ...parseSupplementBody(SUPPLEMENT_TEMPLATE_BODY) });
  }
  try {
    const parsed = parseSupplementMarkdown(fs.readFileSync(filePath, 'utf8'));
    res.json({ ok: true, exists: true, path: filePath, meta, ...parsed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Only the fields a client can legitimately change (Jira references body,
// further resources body, and the current full row set of each table) are
// accepted here - every other structural piece (headings, the
// acknowledgements intro sentence, table column headers, and the front
// matter) is re-read from the existing file (or the template's defaults for
// a brand new one) rather than trusted from the request body, so the
// locked-down parts really can't be changed via this app no matter what the
// client sends.
app.post('/api/component/:dirName/supplement', (req, res) => {
  const { dirName } = req.params;
  if (!/^[\w.\-]+$/.test(dirName)) {
    return res.status(400).json({ ok: false, error: 'Invalid dirName' });
  }
  const { jiraBody, furtherBody, versionHistoryRows, releaseHistoryRows, acknowledgementsRows } = req.body;
  if (typeof jiraBody !== 'string' || typeof furtherBody !== 'string') {
    return res.status(400).json({ ok: false, error: 'jiraBody and furtherBody must be strings' });
  }
  if (![versionHistoryRows, releaseHistoryRows, acknowledgementsRows].every(Array.isArray)) {
    return res.status(400).json({ ok: false, error: 'versionHistoryRows, releaseHistoryRows and acknowledgementsRows must be arrays' });
  }
  try {
    const root = resolveRepoRoot(req);
    const filePath = findSupplementFile(root, dirName) || path.join(specificationsDir(root), dirName, 'Diagrams', defaultSupplementFileName(root, dirName));
    const meta = readComponentMeta(root, dirName);
    if (!meta || !meta.name || !meta.version) {
      return res.status(400).json({ ok: false, error: "Could not read this component's name/version from its YAML - save the Metadata tab first." });
    }
    const existing = fs.existsSync(filePath)
      ? parseSupplementMarkdown(fs.readFileSync(filePath, 'utf8'))
      : parseSupplementBody(SUPPLEMENT_TEMPLATE_BODY);
    const parsed = {
      ...existing,
      jiraBody,
      furtherBody,
      versionHistory: { columns: existing.versionHistory.columns, rows: versionHistoryRows },
      releaseHistory: { columns: existing.releaseHistory.columns, rows: releaseHistoryRows },
      acknowledgements: { columns: existing.acknowledgements.columns, rows: acknowledgementsRows },
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, renderSupplementMarkdown(parsed, meta), 'utf8');
    res.json({ ok: true, path: filePath });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Full parsed YAML for one existing component, to prefill the wizard for editing.
app.get('/api/component/:dirName', (req, res) => {
  const { dirName } = req.params;
  if (!/^[\w.\-]+$/.test(dirName)) {
    return res.status(400).json({ ok: false, error: 'Invalid dirName' });
  }
  const match = listComponentYamlFiles(resolveRepoRoot(req)).find((f) => f.dirName === dirName);
  if (!match) {
    return res.status(404).json({ ok: false, error: `No component directory ${dirName}` });
  }
  try {
    const component = normalizeDates(yaml.load(fs.readFileSync(match.yamlPath, 'utf8')));
    res.json({ ok: true, dirName: match.dirName, fileName: path.basename(match.yamlPath), component });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Next unused TMFCxxx id, based on existing component directories.
app.get('/api/next-id', (req, res) => {
  let max = 0;
  for (const dirName of listComponentDirs(resolveRepoRoot(req))) {
    const m = dirName.match(/^TMFC(\d+)-/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const next = max + 1;
  res.json({ id: `TMFC${String(next).padStart(3, '0')}` });
});

app.post('/api/validate', (req, res) => {
  try {
    const validate = buildValidator(resolveRepoRoot(req));
    const component = req.body.component;
    const valid = validate(component);
    res.json({ valid, errors: valid ? [] : validate.errors });
  } catch (err) {
    res.status(500).json({ valid: false, errors: [{ message: err.message }] });
  }
});

function repoOwnerAndName(remoteUrl) {
  const m = remoteUrl && remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function githubApiRequest(token, method, apiPath, body) {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'component-doc-web-studio',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `GitHub API ${method} ${apiPath} failed (${res.status})`);
  return json;
}

// Every signed-in user's workspace clone (see ensureWorkspace) commits to its
// own branch - created lazily on first save, reused for the rest of that
// session - rather than to the base branch directly.
function ensureSessionBranch(req) {
  if (!req.session.branchName) {
    const slug = (req.session.user.login || 'user').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    req.session.branchName = `web-studio/${slug}/${req.sessionID.slice(0, 8)}`;
  }
  return req.session.branchName;
}

// Commits whatever's currently changed in the session's workspace clone,
// pushes it to that session's branch, and opens a PR the first time (later
// saves just push more commits to the same branch/PR) - this is what turns
// "Save" into "propose a change" instead of writing straight to the shared
// repo, matching how this app's users already worked by hand (route changes
// via PR - see feedback_pr_workflow_doc_spec_studio in project memory).
// Returns { committed: false } with no other side effects if nothing in the
// workspace actually changed (e.g. a save that reproduces the existing file).
async function commitAndOpenPR(req, { message, prTitle }) {
  const root = req.workspaceDir;
  const user = req.session.user;
  const branch = ensureSessionBranch(req);

  execFileSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8' });
  if (!runGit(root, ['status', '--porcelain'])) {
    return { committed: false };
  }

  const currentBranch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (currentBranch !== branch) {
    const branchExists = runGit(root, ['rev-parse', '--verify', branch]) !== null;
    execFileSync('git', branchExists ? ['checkout', branch] : ['checkout', '-b', branch], { cwd: root, encoding: 'utf8' });
  }

  execFileSync(
    'git',
    ['-c', `user.name=${user.name || user.login}`, '-c', `user.email=${user.login}@users.noreply.github.com`, 'commit', '-m', message],
    { cwd: root, encoding: 'utf8' },
  );

  const remoteUrl = runGit(root, ['remote', 'get-url', 'origin']);
  const identity = repoOwnerAndName(remoteUrl);
  if (!identity) throw new Error(`Could not parse a GitHub owner/repo from remote URL: ${remoteUrl}`);
  const pushUrl = remoteUrl.replace('https://', `https://x-access-token:${user.accessToken}@`);
  execFileSync('git', ['push', pushUrl, `HEAD:${branch}`], { cwd: root, encoding: 'utf8' });

  if (!req.session.prUrl) {
    const pr = await githubApiRequest(user.accessToken, 'POST', `/repos/${identity.owner}/${identity.repo}/pulls`, {
      title: prTitle,
      head: branch,
      base: SPEC_REPO_BRANCH,
      body: `Opened automatically by ODA Web Studio on behalf of @${user.login}.`,
    });
    req.session.prUrl = pr.html_url;
    req.session.prNumber = pr.number;
  }

  return { committed: true, prUrl: req.session.prUrl, prNumber: req.session.prNumber, branch };
}

app.post('/api/save', async (req, res) => {
  try {
    const root = resolveRepoRoot(req);
    const { component, dirName, fileName, force } = req.body;
    if (!dirName || !fileName || !component) {
      return res.status(400).json({ ok: false, error: 'dirName, fileName and component are required' });
    }
    if (!/^[\w.\-]+$/.test(dirName) || !/^[\w.\-]+\.yaml$/.test(fileName)) {
      return res.status(400).json({ ok: false, error: 'Invalid dirName or fileName' });
    }

    const validate = buildValidator(root);
    const valid = validate(component);
    if (!valid) {
      return res.status(422).json({ ok: false, error: 'Component fails schema validation', errors: validate.errors });
    }

    const targetDir = path.join(specificationsDir(root), dirName);
    const targetFile = path.join(targetDir, fileName);

    if (fs.existsSync(targetFile) && !force) {
      return res.status(409).json({ ok: false, error: `${fileName} already exists in ${dirName}` });
    }

    fs.mkdirSync(targetDir, { recursive: true });
    const yamlText = yaml.dump(component, { sortKeys: false, lineWidth: -1, noArrayIndent: true });
    fs.writeFileSync(targetFile, yamlText, 'utf8');

    // Only per-session workspaces (SPEC_REPO_URL configured) can commit/push -
    // the Stage 1/2 shared-REPO_ROOT fallback just writes the file, as before.
    const pr = req.workspaceDir
      ? await commitAndOpenPR(req, {
        message: `Update ${dirName}/${fileName} via ODA Web Studio`,
        prTitle: `${dirName}: update component spec (${req.session.user.login})`,
      })
      : null;

    res.json({ ok: true, path: targetFile, pr });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Flushes any pending workspace changes into a commit/PR independent of
// /api/save - covers edits made only via Links/Descriptions/Document
// History/Common architectural patterns in a session that never also saved
// a component's YAML.
app.post('/api/submit-pr', async (req, res) => {
  if (!req.workspaceDir) {
    return res.status(400).json({ ok: false, error: 'PR submission requires per-session workspaces (SPEC_REPO_URL) to be configured.' });
  }
  try {
    const pr = await commitAndOpenPR(req, {
      message: `Update component specifications via ODA Web Studio (${req.session.user.login})`,
      prTitle: `ODA Web Studio changes from ${req.session.user.login}`,
    });
    res.json({ ok: true, pr });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Locates the built client (client/dist) to serve as static files, so a
// packaged .exe can be one self-contained process instead of needing a
// separate Vite dev server. Checked in order: a "public" folder shipped next
// to the packaged exe, a "public" folder next to this script, then the
// monorepo dev layout (../client/dist) - whichever has an index.html wins.
// process.argv[1] (not __dirname/import.meta.url) is used deliberately so
// this works unchanged whether run as raw ESM in dev or bundled to CJS.
function resolvePublicDir() {
  const scriptDir = path.dirname(process.argv[1] || '.');
  const candidates = [
    process.pkg ? path.join(path.dirname(process.execPath), 'public') : null,
    path.join(scriptDir, 'public'),
    path.join(scriptDir, '..', 'client', 'dist'), // dev: index.js run from server/
    path.join(scriptDir, '..', '..', 'client', 'dist'), // dev: bundle.cjs run from server/dist/
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(path.join(p, 'index.html'))) || null;
}

const PUBLIC_DIR = resolvePublicDir();
if (PUBLIC_DIR) {
  app.use(express.static(PUBLIC_DIR));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
}

const PORT = process.env.PORT || 4310;
app.listen(PORT, () => {
  console.log(`component-doc-specification-studio server listening on http://localhost:${PORT}`);
  console.log(`REPO_ROOT=${REPO_ROOT} (source: ${REPO_ROOT_SOURCE})`);
  console.log(PUBLIC_DIR ? `Serving built client from ${PUBLIC_DIR}` : 'No built client found - API only (run the Vite dev server separately).');
});
