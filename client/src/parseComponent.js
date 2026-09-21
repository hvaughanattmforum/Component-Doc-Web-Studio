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

// Each entry in an eventAPI's `specification` is a distinct released version
// of that event group with its own event-name list - e.g. TMF652 v4 renamed
// several events published under v3. One editable row per specification
// entry, same pattern as parseSpecEntry for APIs above.
function parseEventSpecEntry(specEntry) {
  return {
    version: specEntry?.version !== undefined ? String(specEntry.version) : '',
    apiType: specEntry?.apiType || 'openapi',
    events: Array.isArray(specEntry?.events) ? specEntry.events : [],
    raw: specEntry || {},
  };
}

// Reads both the current eventAPI shape (`specification: [{version, events,
// ...}]`, matching how exposedAPI/dependentAPI are versioned) and the older
// flat shape it replaced (a single top-level `resources` list plus
// `apiType`/`hub`/`call-back`/`implementation`/`port`). Older components on
// disk may still be in the flat shape, and this wizard can still open them -
// but saving always re-emits the current versioned shape (see
// buildEventEntry), since the schema no longer allows the flat one. The flat
// shape is read-only here: its fields are folded into a single synthesized
// specification row so the wizard doesn't crash or blank the form, but that
// row's now-invalid fields (hub/call-back/implementation/port) aren't
// preserved on save.
function parseEventEntry(entry) {
  const specs = Array.isArray(entry.specification) ? entry.specification : null;
  const specifications = specs
    ? (specs.length ? specs.map(parseEventSpecEntry) : [parseEventSpecEntry(null)])
    : [parseEventSpecEntry({ apiType: entry.apiType || entry.apitype, events: entry.resources })];
  return {
    id: entry.id || '',
    name: entry.name || '',
    specifications,
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
    publishedEvents: (core.publishedEvents || []).map(parseEventEntry),
    subscribedEvents: (core.subscribedEvents || []).map(parseEventEntry),
  };
}
