import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { matchCatalogEntry } from '../apiCatalogUtils.js';

// Published events are notifications for resources the component itself
// exposes, so the event group name has to match one of the component's own
// exposed APIs - e.g. TMF620's swagger titles itself "Product Catalog
// Management", published as event name "ProductCatalogManagement". That
// name comes straight from the API's own swagger (info.title) rather than
// being typed in or guessed. Keyed by id (not name) since id is the exposed
// API's real identity - matches how exposedAPIs/dependentAPIs key off `id`
// rather than the human-readable name. Only resolves the name, not the
// per-version event list - each specification version fetches its own event
// list independently (see EventSpecVersionCard), since a later version of
// the same event group can rename or add events.
function useExposedApiEventNames(exposedAPIs, apiCatalog) {
  const [byId, setById] = useState({}); // { [apiId]: name }
  const [loading, setLoading] = useState({});
  const fetched = useRef(new Set());

  const ids = [...new Set(exposedAPIs.map((a) => (a.id || '').trim()).filter(Boolean))];
  const key = ids.join(',');

  useEffect(() => {
    ids.forEach((id) => {
      if (fetched.current.has(id)) return;
      const api_ = exposedAPIs.find((a) => (a.id || '').trim() === id);
      const match = matchCatalogEntry(apiCatalog, id, api_?.specifications?.[0]?.version);
      if (!match) return;
      fetched.current.add(id);
      setLoading((prev) => ({ ...prev, [id]: true }));
      api.apiResources(match.swagger)
        .then((result) => {
          if (result.eventName) setById((prev) => ({ ...prev, [id]: result.eventName }));
        })
        .catch(() => {})
        .finally(() => setLoading((prev) => ({ ...prev, [id]: false })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, apiCatalog]);

  const options = ids.filter((id) => byId[id]).map((id) => ({ id, name: byId[id] }));
  const anyLoading = ids.some((id) => loading[id]);

  return { options, byId, anyLoading };
}

// Two even columns rather than a flex-wrap that reflows unpredictably with
// event-name length - a fixed grid keeps the list scannable regardless of
// how many names are long/short.
function EventCheckboxGrid({ events, checked, onToggle }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
      {events.map((ev) => (
        <label key={ev} className="checkbox-row" style={{ fontSize: '0.85rem' }}>
          <input type="checkbox" checked={checked.has(ev)} onChange={() => onToggle(ev)} />
          {ev}
        </label>
      ))}
    </div>
  );
}

// Checking boxes only ever edits local, pending state - nothing is written
// back to the component's spec until Save is clicked, mirroring the
// resource picker's Add/Edit-operations pattern rather than committing on
// every click. Once saved, collapses to a read-only summary with an Edit
// button to reopen it. Pass a `key` that changes whenever the underlying
// event list changes (e.g. a different version's swagger loaded), so this
// remounts with fresh state instead of carrying over a stale selection.
function EventSelector({ events, selected, onSave }) {
  const [editing, setEditing] = useState(selected.length === 0);
  const [checked, setChecked] = useState(() => new Set(selected));

  if (!events.length && !selected.length) {
    return <div className="hint">This API's swagger has no /listener event paths.</div>;
  }
  // Anything already selected but not in the fetched list (e.g. a legacy or
  // hand-typed name from before this version had a swagger match) is still
  // shown and stays checkable, so editing an existing component never
  // silently drops or hides data - it's just not one of the version's
  // currently-known events.
  const allEvents = [...events, ...selected.filter((r) => !events.includes(r))];

  const toggle = (ev) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(ev)) next.delete(ev); else next.add(ev);
    return next;
  });

  if (!editing) {
    return (
      <div>
        {selected.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px', marginBottom: 8 }}>
            {selected.map((ev) => <div key={ev} className="hint">{ev}</div>)}
          </div>
        ) : (
          <div className="hint" style={{ display: 'block', marginBottom: 6 }}>No events selected.</div>
        )}
        <button type="button" className="save" onClick={() => { setChecked(new Set(selected)); setEditing(true); }}>
          Edit events
        </button>
      </div>
    );
  }

  return (
    <div>
      <EventCheckboxGrid events={allEvents} checked={checked} onToggle={toggle} />
      <button
        type="button"
        className="save"
        style={{ marginTop: 10 }}
        onClick={() => { onSave([...checked]); setEditing(false); }}
      >
        Save
      </button>
    </div>
  );
}

function ManualEventNameRows({ events, onChange }) {
  const set = (i, value) => {
    const next = events.slice();
    next[i] = value;
    onChange(next);
  };
  const add = () => onChange([...events, '']);
  const remove = (i) => onChange(events.filter((_, idx) => idx !== i));

  return (
    <div>
      {events.map((ev, i) => (
        <div className="row" key={i} style={{ marginBottom: 4 }}>
          <input type="text" value={ev} onChange={(e) => set(i, e.target.value)} placeholder="eventName" />
          <button type="button" className="remove" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" className="save" onClick={add}>+ Add event name manually</button>
    </div>
  );
}

const LOCKED_MESSAGE = 'If this needs changing, please delete and start again.';

// One card per declared specification version of an event group - each
// version manages its own event-name list independently, since a later
// version of the underlying API can rename or add events (e.g. TMF652 v4
// renamed several events published under v3). Mirrors ApiListStep.jsx's
// SpecVersionCard/ResourcePicker pattern: a manual "Load" button fetches the
// real swagger for that specific (id, version) pair rather than relying on
// an always-on background fetch.
function EventSpecVersionCard({ apiId, spec, apiCatalog, onChange, onRemove, removable }) {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const match = matchCatalogEntry(apiCatalog, (apiId || '').trim(), spec.version);

  const load = async () => {
    if (!match) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.apiResources(match.swagger);
      setEvents(result.events || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ background: 'var(--panel-alt, rgba(255,255,255,0.03))' }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <div className="field">
          <label>Version</label>
          <input
            type="text"
            value={spec.version}
            onChange={(e) => { onChange('version', e.target.value); setEvents(null); }}
            placeholder="4"
          />
        </div>
        <div className="field">
          <label>API type</label>
          <input type="text" value={spec.apiType} onChange={(e) => onChange('apiType', e.target.value)} />
        </div>
        {removable && <button type="button" className="ghost" onClick={onRemove}>Remove version</button>}
      </div>
      <div className="field">
        <label>Events <span className="hint">from the API's real swagger spec</span></label>
        {!match && (
          <div className="hint">
            No catalog entry found for {apiId || '(no API selected)'}{spec.version ? ` v${spec.version}` : ''} - add event names manually below.
          </div>
        )}
        {match && !events && (
          <button type="button" onClick={load} disabled={loading}>
            {loading ? 'Loading spec...' : `Load events from ${match.id} v${match.version} spec`}
          </button>
        )}
        {error && <div className="status-banner error" style={{ marginTop: 8 }}>{error}</div>}
        {events && (
          <EventSelector
            key={`${match?.id}::${spec.version}`}
            events={events}
            selected={spec.events}
            onSave={(evs) => onChange('events', evs)}
          />
        )}
        {!match && <ManualEventNameRows events={spec.events} onChange={(v) => onChange('events', v)} />}
      </div>
    </div>
  );
}

const newSpec = () => ({ version: '', apiType: 'openapi', events: [], raw: {} });

// Renders the "Specification versions" block shared by published and
// subscribed event cards - one card is structurally identical to the other
// now that both use the eventAPI definition (id/name/specification[]).
function EventSpecVersionsField({ apiId, specifications, apiCatalog, onChange }) {
  const updateSpec = (specIdx, field, value) => {
    const next = specifications.slice();
    next[specIdx] = { ...next[specIdx], [field]: value };
    onChange(next);
  };
  const addSpec = () => onChange([...specifications, newSpec()]);
  const removeSpec = (specIdx) => onChange(specifications.filter((_, idx) => idx !== specIdx));

  return (
    <div className="field">
      <label>Specification versions <span className="hint">each version's events are managed separately</span></label>
      <div className="card-list">
        {specifications.map((spec, specIdx) => (
          <EventSpecVersionCard
            key={specIdx}
            apiId={apiId}
            spec={spec}
            apiCatalog={apiCatalog}
            onChange={(field, value) => updateSpec(specIdx, field, value)}
            onRemove={() => removeSpec(specIdx)}
            removable={specifications.length > 1}
          />
        ))}
      </div>
      <button type="button" className="save" onClick={addSpec}>+ Add specification version</button>
    </div>
  );
}

export default function EventsStep({ state, setState, apiCatalog }) {
  const { options: publishedIdOptions, byId: publishedNameById, anyLoading } = useExposedApiEventNames(state.exposedAPIs, apiCatalog);

  const updatePublished = (i, field, value) => {
    const next = state.publishedEvents.slice();
    next[i] = { ...next[i], [field]: value };
    setState({ ...state, publishedEvents: next });
  };
  // Picking an API ID also fixes the name to that API's real swagger-derived
  // event-group name (not user-editable) - one atomic update so the two
  // fields never drift out of sync with each other.
  const updatePublishedApi = (i, id) => {
    const next = state.publishedEvents.slice();
    next[i] = { ...next[i], id, name: publishedNameById[id] || '' };
    setState({ ...state, publishedEvents: next });
  };
  // An exposed API only has one real event-group identity, so it doesn't
  // make sense for two published-event cards to both claim it - each API id
  // is offered to exactly one card at a time.
  const usedPublishedIds = new Set(state.publishedEvents.map((p) => p.id).filter(Boolean));
  const unusedPublishedOptions = publishedIdOptions.filter((o) => !usedPublishedIds.has(o.id));
  const addPublished = () => {
    const first = unusedPublishedOptions[0];
    setState({
      ...state,
      publishedEvents: [...state.publishedEvents, {
        id: first?.id || '', name: first?.name || '', specifications: [newSpec()],
      }],
    });
  };
  const removePublished = (i) => setState({ ...state, publishedEvents: state.publishedEvents.filter((_, idx) => idx !== i) });

  const updateSubscribed = (i, field, value) => {
    const next = state.subscribedEvents.slice();
    next[i] = { ...next[i], [field]: value };
    setState({ ...state, subscribedEvents: next });
  };
  const addSubscribed = () => setState({
    ...state,
    subscribedEvents: [...state.subscribedEvents, {
      name: '', id: '', specifications: [newSpec()],
    }],
  });
  const removeSubscribed = (i) => setState({ ...state, subscribedEvents: state.subscribedEvents.filter((_, idx) => idx !== i) });

  const addDisabled = unusedPublishedOptions.length === 0;

  return (
    <>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Published events</h3>
        {addDisabled && !anyLoading && publishedIdOptions.length === 0 && (
          <div className="hint" style={{ marginBottom: 10 }}>Add an exposed API first - published events can only be named after one of the component's own exposed APIs.</div>
        )}
        {addDisabled && anyLoading && (
          <div className="hint" style={{ marginBottom: 10 }}>Loading API names from swagger...</div>
        )}
        {addDisabled && !anyLoading && publishedIdOptions.length > 0 && (
          <div className="hint" style={{ marginBottom: 10 }}>Every exposed API already has a published event entry.</div>
        )}
        <div className="card-list">
          {state.publishedEvents.map((item, i) => {
            // Options already claimed by another card are hidden from this
            // one's dropdown - except this card's own current id, which
            // must stay selectable (it's not a duplicate of itself).
            const optionsForThisCard = publishedIdOptions.filter((o) => o.id === item.id || !usedPublishedIds.has(o.id));
            return (
              <div className="card" key={i}>
                <button type="button" className="card-remove remove" onClick={() => removePublished(i)}>Remove</button>
                <div className="row">
                  <div className="field">
                    <label>API ID</label>
                    <select value={item.id} onChange={(e) => updatePublishedApi(i, e.target.value)}>
                      {!publishedIdOptions.some((o) => o.id === item.id) && (
                        <option value={item.id}>{item.id || '(select an exposed API)'}</option>
                      )}
                      {optionsForThisCard.map((o) => (
                        <option key={o.id} value={o.id}>{o.id}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Swagger API Name</label>
                    <input type="text" value={item.name} readOnly className="locked" />
                  </div>
                </div>
                <EventSpecVersionsField
                  apiId={item.id}
                  specifications={item.specifications}
                  apiCatalog={apiCatalog}
                  onChange={(specs) => updatePublished(i, 'specifications', specs)}
                />
              </div>
            );
          })}
          <button type="button" className="save" onClick={addPublished} disabled={addDisabled}>+ Add published event</button>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Subscribed events</h3>
        <div className="card-list">
          {state.subscribedEvents.map((item, i) => {
            // Each API should only be subscribed to once in this panel - id
            // is free text (any external component's API, not a fixed
            // list) so duplicates can only be flagged, not hard-prevented
            // like the published events' select.
            const otherApiIds = state.subscribedEvents
              .filter((_, idx) => idx !== i)
              .map((s) => (s.id || '').trim().toUpperCase())
              .filter(Boolean);
            const thisApiId = (item.id || '').trim().toUpperCase();
            return (
              <SubscribedEventCard
                key={i}
                index={i}
                item={item}
                apiCatalog={apiCatalog}
                excludeApiIds={otherApiIds}
                isDuplicate={!!thisApiId && otherApiIds.includes(thisApiId)}
                onChange={(field, value) => updateSubscribed(i, field, value)}
                onRemove={() => removeSubscribed(i)}
              />
            );
          })}
          <button type="button" className="save" onClick={addSubscribed}>+ Add subscribed event</button>
        </div>
      </div>
    </>
  );
}

// Subscribed events reference some other component's exposed API - there's
// no fixed list to pick from like published events have, so the user looks
// one up in the API catalog by id; the event-group name is free text too
// (not swagger-derived, since that swagger belongs to a component this app
// doesn't own).
function SubscribedEventCard({ item, apiCatalog, onChange, onRemove, index, excludeApiIds, isDuplicate }) {
  const datalistId = `event-api-catalog-options-${index}`;
  // Suggestions exclude APIs already claimed by another subscribed-event
  // card - each API should only be subscribed to once in this panel.
  const availableCatalog = apiCatalog.filter((a) => !excludeApiIds.includes(a.id.toUpperCase()));

  return (
    <div className="card">
      <button type="button" className="card-remove remove" onClick={onRemove}>Remove</button>
      {isDuplicate && (
        <div className="status-banner error" style={{ marginBottom: 10 }}>
          {item.id} is already used by another subscribed event above - each API should only be subscribed to once.
        </div>
      )}
      <div className="row">
        <div className="field">
          <label>API ID <span className="hint">look up in APIIndex</span></label>
          <input
            type="text"
            list={datalistId}
            value={item.id}
            onChange={(e) => onChange('id', e.target.value)}
            placeholder="TMF633"
            className={isDuplicate ? 'duplicate' : undefined}
          />
          <datalist id={datalistId}>
            {availableCatalog.map((a) => <option key={a.key} value={a.id}>{a.name} (v{a.version})</option>)}
          </datalist>
        </div>
        <div className="field">
          <label>API name</label>
          <input type="text" value={item.name} onChange={(e) => onChange('name', e.target.value)} placeholder="ServiceCatalogManagement" />
        </div>
      </div>
      <EventSpecVersionsField
        apiId={item.id}
        specifications={item.specifications}
        apiCatalog={apiCatalog}
        onChange={(specs) => onChange('specifications', specs)}
      />
    </div>
  );
}
