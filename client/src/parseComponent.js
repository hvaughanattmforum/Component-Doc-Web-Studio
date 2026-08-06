// Reverse of buildComponent: turns a raw parsed component YAML object into
// wizard state, prefilling the form for editing. Each API/event entry keeps
// a `raw` copy of itself so buildComponent can merge form edits back over
// fields the UI doesn't expose, instead of dropping them.

function resourcesFromSpecEntry(specEntry) {
  const resources = specEntry?.resources;
  if (!Array.isArray(resources)) return [];
  return resources.map((r) => {
    const [name, verbs] = Object.entries(r)[0] || ['', []];
    return { name, verbs: Array.isArray(verbs) ? verbs.join(', ') : '' };
  });
}

// Each entry in `specification` is a distinct API version with its own,
// independently managed resource/operation list - e.g. TMF620 v5 exposes a
// "productCatalog" resource where v4 called the same thing "catalog". The
// wizard keeps one editable row per specification entry instead of
// collapsing them, so switching/adding a version never overwrites another.
function parseSpecEntry(specEntry) {
  return {
    version: specEntry?.version !== undefined ? String(specEntry.version) : '',
    resources: resourcesFromSpecEntry(specEntry),
    raw: specEntry || {},
  };
}

function parseApiEntry(entry) {
  const specs = Array.isArray(entry.specification) ? entry.specification : [];
  return {
    id: entry.id || '',
    apiSDO: entry.apiSDO || '',
    required: !!entry.required,
    name: entry.name || '',
    specifications: specs.length ? specs.map(parseSpecEntry) : [parseSpecEntry(null)],
    raw: entry,
  };
}

function parseEventEntry(entry, kind) {
  return {
    id: entry.id || '',
    name: entry.name || '',
    hub: kind === 'published' ? (entry.hub || '') : '',
    callback: kind === 'subscribed' ? (entry['call-back'] || '') : '',
    implementation: entry.implementation || '',
    port: entry.port || '',
    specification: entry.specification || '',
    apiType: entry.apiType || '',
    resources: Array.isArray(entry.resources) ? entry.resources : [],
    raw: entry,
  };
}

export function stateFromComponent(component) {
  const meta = component?.spec?.componentMetadata || {};
  const core = component?.spec?.coreFunction || {};

  return {
    id: meta.id || '',
    name: meta.name || '',
    description: meta.description || '',
    version: meta.version || '',
    status: meta.status || 'roadmap',
    publicationDate: meta.publicationDate || '',
    functionalBlock: meta.functionalBlock || '',
    // raw kept (as with API/event entries above) so buildComponent can spread
    // it back underneath the edited fields, preserving this entry's original
    // key order instead of always re-emitting name/email/url in that order.
    owners: (meta.owners || []).map((o) => ({ name: o.name || '', email: o.email || '', url: o.url || '', raw: o })),
    maintainers: (meta.maintainers || []).map((m) => ({ name: m.name || '', email: m.email || '', url: m.url || '', raw: m })),
    eTOMs: meta.eTOMs || [],
    functionalFrameworkFunctions: meta.functionalFrameworkFunctions || [],
    SIDs: meta.SIDs || [],
    exposedAPIs: (core.exposedAPIs || []).map(parseApiEntry),
    dependentAPIs: (core.dependentAPIs || []).map(parseApiEntry),
    publishedEvents: (core.publishedEvents || []).map((e) => parseEventEntry(e, 'published')),
    subscribedEvents: (core.subscribedEvents || []).map((e) => parseEventEntry(e, 'subscribed')),
  };
}
