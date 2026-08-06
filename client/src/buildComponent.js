function verbsOf(text) {
  return (text || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// Builds one `specification[]` entry, merging form-edited fields over a
// `raw` passthrough so fields the wizard doesn't expose (apiType, url,
// path, developerUI, etc.) survive a round trip unchanged.
function buildSpecEntry(spec) {
  const raw = spec.raw ? JSON.parse(JSON.stringify(spec.raw)) : {};
  const out = { ...raw };
  const versionValue = spec.version
    ? (isNaN(spec.version) ? spec.version.trim() : Number(spec.version))
    : undefined;
  if (versionValue !== undefined) out.version = versionValue;
  else delete out.version;

  const resources = (spec.resources || [])
    .filter((r) => r.name && r.name.trim())
    .map((r) => ({ [r.name.trim()]: verbsOf(r.verbs) }));
  if (resources.length) out.resources = resources;
  else delete out.resources;

  return out;
}

// Builds an API entry, merging form-edited fields over a `raw` passthrough
// (the original entry, when editing an existing component) so fields the
// wizard doesn't expose (path, developerUI, implementation, apiType)
// survive a round trip unchanged. `specifications` holds one row per
// version - each managed and saved independently, since different versions
// of the same API can expose entirely different resources.
function buildApiEntry(entry) {
  const raw = entry.raw ? JSON.parse(JSON.stringify(entry.raw)) : {};
  const out = {
    ...raw,
    id: entry.id.trim(),
    required: !!entry.required,
  };
  if (entry.apiSDO) out.apiSDO = entry.apiSDO.trim();
  else delete out.apiSDO;
  if (entry.name) out.name = entry.name.trim();

  const specifications = (entry.specifications || [])
    .filter((s) => s.version || (s.resources || []).some((r) => r.name && r.name.trim()) || Object.keys(s.raw || {}).length)
    .map(buildSpecEntry);

  if (specifications.length) out.specification = specifications;
  else delete out.specification;

  return out;
}

function buildEventEntry(entry, kind) {
  const raw = entry.raw ? JSON.parse(JSON.stringify(entry.raw)) : {};
  const out = { ...raw, id: (entry.id || '').trim(), name: entry.name.trim() };
  if (kind === 'published' && entry.hub) out.hub = entry.hub.trim();
  if (kind === 'subscribed' && entry.callback) out['call-back'] = entry.callback.trim();
  if (entry.implementation) out.implementation = entry.implementation.trim();
  if (entry.port) out.port = Number(entry.port);
  const resources = (entry.resources || []).map((r) => r.trim()).filter(Boolean);
  if (resources.length) out.resources = resources;
  if (entry.specification) out.specification = entry.specification.trim();
  if (entry.apiType) out.apiType = entry.apiType.trim();
  return out;
}

// `original` is the full raw component object being edited (null when
// creating new), used so spec-level fields the wizard doesn't model
// (managementFunction, securityFunction, etc.) are preserved untouched.
export function buildComponent(state, original) {
  const originalMeta = original?.spec?.componentMetadata || {};
  const componentMetadata = {
    ...originalMeta,
    id: state.id.trim(),
    name: state.name.trim(),
    version: state.version.trim(),
    description: state.description.trim(),
    publicationDate: state.publicationDate || null,
    status: state.status,
    functionalBlock: state.functionalBlock.trim(),
  };

  // Spreading raw first (same pattern as buildApiEntry/buildEventEntry above)
  // preserves this entry's original key order for an existing owner/
  // maintainer - only a newly-added one (no raw) falls back to name/email/url.
  const owners = state.owners.filter((o) => o.name || o.email);
  if (owners.length) componentMetadata.owners = owners.map((o) => ({ ...(o.raw || {}), name: o.name, email: o.email, url: o.url || 'Redacted' }));
  else delete componentMetadata.owners;

  const maintainers = state.maintainers.filter((m) => m.name || m.email);
  if (maintainers.length) componentMetadata.maintainers = maintainers.map((m) => ({ ...(m.raw || {}), name: m.name, email: m.email, url: m.url || 'Redacted' }));
  else delete componentMetadata.maintainers;

  const eTOMs = (state.eTOMs || []).filter(Boolean);
  if (eTOMs.length) componentMetadata.eTOMs = eTOMs;
  else delete componentMetadata.eTOMs;

  const functionalFrameworkFunctions = (state.functionalFrameworkFunctions || []).filter(Boolean);
  if (functionalFrameworkFunctions.length) componentMetadata.functionalFrameworkFunctions = functionalFrameworkFunctions;
  else delete componentMetadata.functionalFrameworkFunctions;

  const SIDs = (state.SIDs || []).filter(Boolean);
  if (SIDs.length) componentMetadata.SIDs = SIDs;
  else delete componentMetadata.SIDs;

  const originalCoreFunction = original?.spec?.coreFunction || {};
  const coreFunction = {
    ...originalCoreFunction,
    exposedAPIs: state.exposedAPIs.filter((a) => a.id.trim()).map(buildApiEntry),
  };

  const dependentAPIs = state.dependentAPIs.filter((a) => a.id.trim()).map(buildApiEntry);
  if (dependentAPIs.length) coreFunction.dependentAPIs = dependentAPIs;
  else delete coreFunction.dependentAPIs;

  const publishedEvents = state.publishedEvents.filter((e) => e.name.trim()).map((e) => buildEventEntry(e, 'published'));
  if (publishedEvents.length) coreFunction.publishedEvents = publishedEvents;
  else delete coreFunction.publishedEvents;

  const subscribedEvents = state.subscribedEvents.filter((e) => e.name.trim()).map((e) => buildEventEntry(e, 'subscribed'));
  if (subscribedEvents.length) coreFunction.subscribedEvents = subscribedEvents;
  else delete coreFunction.subscribedEvents;

  return {
    apiVersion: original?.apiVersion || 'oda.tmforum.org/v1',
    kind: original?.kind || 'Component',
    metadata: original?.metadata || { name: 'components.oda.tmforum.org' },
    spec: {
      ...(original?.spec || {}),
      coreFunction,
      componentMetadata,
    },
  };
}

export function fileNamesFor(state) {
  const dirName = `${state.id.trim()}-${state.name.trim()}`;
  const fileName = `${dirName}.yaml`;
  return { dirName, fileName };
}
