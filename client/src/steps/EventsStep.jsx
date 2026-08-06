import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { matchCatalogEntry } from '../apiCatalogUtils.js';

// Published events are notifications for resources the component itself
// exposes, so the event group name has to match one of the component's own
// exposed APIs - e.g. TMF620's swagger titles itself "Product Catalog
// Management", published as event name "ProductCatalogManagement". That
// name, and the list of events available to publish, both come straight
// from the API's own swagger (info.title and its /listener/* paths) rather
// than being typed in or guessed. Keyed by id (not name) since id is the
// exposed API's real identity - matches how exposedAPIs/dependentAPIs key
// off `id` rather than the human-readable name.
function useExposedApiEvents(exposedAPIs, apiCatalog) {
  const [byId, setById] = useState({}); // { [apiId]: { name, events } }
  const [loading, setLoading] = useState({}); // { [apiId]: true }
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
          if (result.eventName) {
            setById((prev) => ({ ...prev, [id]: { name: result.eventName, events: result.events || [] } }));
          }
        })
        .catch(() => {})
        .finally(() => setLoading((prev) => ({ ...prev, [id]: false })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, apiCatalog]);

  const options = ids
    .filter((id) => byId[id])
    .map((id) => ({ id, name: byId[id].name }));
  const eventsById = Object.fromEntries(options.map((o) => [o.id, byId[o.id].events]));
  const anyLoading = ids.some((id) => loading[id]);

  return { options, byId, eventsById, anyLoading };
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
// button to reopen it. Pass a `key` that changes whenever the underlying API/
// event list changes (e.g. a different exposed API selected), so this
// remounts with fresh state instead of carrying over a stale selection.
function EventSelector({ events, selected, onSave }) {
  const [editing, setEditing] = useState(selected.length === 0);
  const [checked, setChecked] = useState(() => new Set(selected));

  if (!events.length && !selected.length) {
    return <div className="hint">This API's swagger has no /listener event paths.</div>;
  }
  // Anything already selected but not in the fetched list (e.g. a legacy or
  // hand-typed name from before this API had a swagger match) is still shown
  // and stays checkable, so editing an existing component never silently
  // drops or hides data - it's just not one of the API's currently-known
  // events.
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

function ManualResourceRows({ resources, onChange }) {
  const set = (i, value) => {
    const next = resources.slice();
    next[i] = value;
    onChange(next);
  };
  const add = () => onChange([...resources, '']);
  const remove = (i) => onChange(resources.filter((_, idx) => idx !== i));

  return (
    <div>
      {resources.map((r, i) => (
        <div className="row" key={i} style={{ marginBottom: 4 }}>
          <input type="text" value={r} onChange={(e) => set(i, e.target.value)} placeholder="eventName" />
          <button type="button" className="remove" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" className="save" onClick={add}>+ Add event name manually</button>
    </div>
  );
}

export default function EventsStep({ state, setState, apiCatalog }) {
  const { options: publishedIdOptions, byId: publishedById, eventsById, anyLoading } = useExposedApiEvents(state.exposedAPIs, apiCatalog);

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
    next[i] = { ...next[i], id, name: publishedById[id]?.name || '' };
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
        id: first?.id || '', name: first?.name || '', apiType: 'openapi', resources: [],
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
      name: '', id: '', apiType: 'openapi', resources: [],
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
            const events = eventsById[item.id] || [];
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
                  <div className="field">
                    <label>API type</label>
                    <input type="text" value={item.apiType} onChange={(e) => updatePublished(i, 'apiType', e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label>Available events <span className="hint">from the API's real swagger spec</span></label>
                  {anyLoading && !events.length ? (
                    <div className="hint">Loading events from swagger...</div>
                  ) : events.length ? (
                    <EventSelector
                      key={item.id}
                      events={events}
                      selected={item.resources}
                      onSave={(evs) => updatePublished(i, 'resources', evs)}
                    />
                  ) : (
                    <ManualResourceRows resources={item.resources} onChange={(v) => updatePublished(i, 'resources', v)} />
                  )}
                </div>
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
            // Same one-API-per-card rule as published events, but id is
            // free text (any external component's API, not a fixed list) so
            // it can only be discouraged (datalist suggestions exclude ids
            // taken elsewhere) and flagged, not hard-prevented like a select.
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
// one up in the API catalog by id, and we fetch its swagger the same way
// (event name from info.title, available events from /listener/* paths).
function SubscribedEventCard({ item, apiCatalog, onChange, onRemove, index, excludeApiIds, isDuplicate }) {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const match = matchCatalogEntry(apiCatalog, (item.id || '').trim());
  const datalistId = `event-api-catalog-options-${index}`;
  // Suggestions exclude APIs already claimed by another subscribed-event
  // card - each API should only be subscribed to once in this panel.
  const availableCatalog = apiCatalog.filter((a) => !excludeApiIds.includes(a.id.toUpperCase()));

  const lookup = async () => {
    if (!match) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.apiResources(match.swagger);
      setEvents(result.events || []);
      if (result.eventName && !item.name) onChange('name', result.eventName);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

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
            onChange={(e) => { onChange('id', e.target.value); setEvents(null); }}
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
        <div className="field">
          <label>API type</label>
          <input type="text" value={item.apiType} onChange={(e) => onChange('apiType', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Available events <span className="hint">from the API's real swagger spec</span></label>
        {!match && <div className="hint">No catalog entry found for {item.id || '(no id entered)'} - add event names manually below.</div>}
        {match && !events && (
          <button type="button" onClick={lookup} disabled={loading}>
            {loading ? 'Loading spec...' : `Load events from ${match.id} v${match.version} spec`}
          </button>
        )}
        {error && <div className="status-banner error" style={{ marginTop: 8 }}>{error}</div>}
        {events && (
          <EventSelector
            key={match?.id}
            events={events}
            selected={item.resources}
            onSave={(evs) => onChange('resources', evs)}
          />
        )}
        {!match && (
          <ManualResourceRows resources={item.resources} onChange={(v) => onChange('resources', v)} />
        )}
      </div>
    </div>
  );
}
