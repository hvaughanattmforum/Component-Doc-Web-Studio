const BASE = '/api';

async function json(res) {
  const body = await res.json();
  if (!res.ok && !('valid' in body)) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export const api = {
  health: () => fetch(`${BASE}/health`).then(json),
  me: () => fetch(`${BASE}/me`).then(json),
  logout: () => fetch('/auth/logout', { method: 'POST' }).then(json),
  gitBranches: () => fetch(`${BASE}/git/branches`).then(json),
  checkoutBranch: (branch) => fetch(`${BASE}/git/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  gitWorktrees: () => fetch(`${BASE}/git/worktrees`).then(json),
  createWorktree: (branch) => fetch(`${BASE}/git/worktrees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  selectWorktree: (path) => fetch(`${BASE}/git/worktrees/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  removeWorktree: (path) => fetch(`${BASE}/git/worktrees`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  pushToOrigin: () => fetch(`${BASE}/git/push`, { method: 'POST' })
    .then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  branchName: () => fetch(`${BASE}/git/branch-name`).then(json),
  setBranchName: (branch) => fetch(`${BASE}/git/branch-name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  getConfig: () => fetch(`${BASE}/config`).then(json),
  // partial: { repoRoot? , frameworksDir? } - either or both may be set independently.
  setConfig: (partial) => fetch(`${BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  functionalBlocks: () => fetch(`${BASE}/functional-blocks`).then(json),
  apis: () => fetch(`${BASE}/apis`).then(json),
  nextId: () => fetch(`${BASE}/next-id`).then(json),
  components: () => fetch(`${BASE}/components`).then(json),
  componentVersions: (dirName) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}/versions`).then(json),
  // versionDir omitted -> server's latest for this component.
  component: (dirName, versionDir) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}${versionDir ? `?version=${encodeURIComponent(versionDir)}` : ''}`).then(json),
  componentLinks: (dirName, versionDir) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}/links?version=${encodeURIComponent(versionDir)}`).then(json),
  saveComponentLinks: (dirName, versionDir, payload) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, version: versionDir }),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  componentEtomDescriptions: (dirName, versionDir) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}/etom-descriptions?version=${encodeURIComponent(versionDir)}`).then(json),
  saveComponentEtomDescriptions: (dirName, versionDir, payload) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}/etom-descriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, version: versionDir }),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  componentFFDescriptions: (dirName, versionDir) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}/ff-descriptions?version=${encodeURIComponent(versionDir)}`).then(json),
  saveComponentFFDescriptions: (dirName, versionDir, payload) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}/ff-descriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, version: versionDir }),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  componentSidDescriptions: (dirName, versionDir) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}/sid-descriptions?version=${encodeURIComponent(versionDir)}`).then(json),
  saveComponentSidDescriptions: (dirName, versionDir, payload) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}/sid-descriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, version: versionDir }),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  // Repo-root-level (not per-component) common architectural pattern links -
  // see docs/Common_Links/ in the target repo.
  commonComponentSidOwnerLinks: () => fetch(`${BASE}/common-component-sid-owner-links`).then(json),
  saveCommonComponentSidOwnerLinks: (payload) => fetch(`${BASE}/common-component-sid-owner-links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  componentSupplement: (dirName, versionDir) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}/supplement?version=${encodeURIComponent(versionDir)}`).then(json),
  // payload: { jiraBody, furtherBody, versionHistoryRows, releaseHistoryRows, acknowledgementsRows }
  saveComponentSupplement: (dirName, versionDir, payload) => fetch(`${BASE}/component/${encodeURIComponent(dirName)}/supplement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, version: versionDir }),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  // kind: 'etom' | 'sid' | 'functional-framework'. version omitted -> server's latest.
  frameworkCatalog: (kind, version) => fetch(`${BASE}/${kind}${version ? `?version=${encodeURIComponent(version)}` : ''}`).then(json),
  frameworkVersions: (kind) => fetch(`${BASE}/${kind}/versions`).then(json),
  regenerateFrameworks: () => fetch(`${BASE}/frameworks/regenerate`, { method: 'POST' })
    .then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  apiResources: (swaggerUrl) => fetch(`${BASE}/api-resources?swagger=${encodeURIComponent(swaggerUrl)}`).then(json),
  validate: (component) => fetch(`${BASE}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ component }),
  }).then(json),
  save: (payload) => fetch(`${BASE}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => res.json().then((body) => ({ status: res.status, ...body }))),
  createGithubIssue: (payload) => fetch(`${BASE}/github/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json),
};
