import React, {useEffect, useMemo, useState} from 'react';
import {config} from './config';
import {ApiError, createApi} from './api';

const idField = config.idField;

function humanValue(value, field, entities) {
  if (value === undefined || value === null || value === '') return '—';
  if (field && field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field && field.type === 'date') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }
  if (field && field.type === 'reference') {
    const target = entities.find(entity => entity.name === field.ref);
    const titleField = target && target.titleField;
    const formatOne = item => {
      if (item && typeof item === 'object') {
        return String(item[titleField] ?? item[idField] ?? item.id ?? item._id ?? 'Record');
      }
      return String(item);
    };
    return Array.isArray(value) ? value.map(formatOne).join(', ') : formatOne(value);
  }
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function widgetFor(field) {
  if (field.widget && field.widget !== 'auto') return field.widget;
  if (field.enum && field.enum.length) return 'select';
  if (field.type === 'reference') return 'reference';
  if (field.type === 'number') return 'number';
  if (field.type === 'boolean') return 'checkbox';
  if (field.type === 'date') return 'datetime';
  return 'text';
}

function validateValues(entity, values, editing) {
  const errors = {};
  for (const field of entity.fields) {
    if (field.hidden || field.readonly) continue;
    const value = values[field.name];

    if (!editing && field.required && field.default === undefined &&
        (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0))) {
      errors[field.name] = field.label + ' is required';
      continue;
    }

    if (value === undefined || value === null || value === '') continue;

    if (field.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) errors[field.name] = field.label + ' must be a number';
      else {
        if (field.min !== undefined && number < field.min) errors[field.name] = field.label + ' must be at least ' + field.min;
        if (field.max !== undefined && number > field.max) errors[field.name] = field.label + ' must be at most ' + field.max;
      }
    }

    if (field.type === 'string') {
      const text = String(value);
      if (field.minLength !== undefined && text.length < field.minLength) errors[field.name] = field.label + ' is too short';
      if (field.maxLength !== undefined && text.length > field.maxLength) errors[field.name] = field.label + ' is too long';
      if (field.enum && field.enum.length && !field.enum.includes(value)) errors[field.name] = field.label + ' has an invalid value';
    }
  }
  return errors;
}

function payloadFor(entity, values) {
  const payload = {};
  for (const field of entity.fields) {
    if (field.hidden || field.readonly) continue;
    let value = values[field.name];
    if (value === '' || value === undefined) continue;
    if (field.type === 'number') value = Number(value);
    if (field.type === 'boolean') value = Boolean(value);
    if (field.type === 'date' && value) value = new Date(value).toISOString();
    payload[field.name] = value;
  }
  return payload;
}

function Button({children, variant = 'secondary', ...props}) {
  return <button className={'button button-' + variant} {...props}>{children}</button>;
}

function Toast({message, onClose}) {
  if (!message) return null;
  return <div className={'toast ' + (message.type === 'error' ? 'toast-error' : '')}>
    <span>{message.text}</span>
    <button aria-label="Close notification" onClick={onClose}>×</button>
  </div>;
}

function TokenGate({children}) {
  const [token, setToken] = useState(() => {
    if (!config.authEnabled) return '';
    const storage = window[config.auth.tokenStorage];
    return storage.getItem(config.auth.tokenKey) || '';
  });
  const [draft, setDraft] = useState(token);

  if (!config.authEnabled) return children;

  if (!token) {
    return <main className="auth-screen">
      <section className="auth-card">
        <div className="brand-mark">J2E</div>
        <h1>{config.title}</h1>
        <p>Paste a bearer token to access protected admin operations.</p>
        <textarea aria-label="Bearer token" value={draft} onChange={event => setDraft(event.target.value)}
          rows="5" placeholder="eyJ..." />
        <Button variant="primary" disabled={!draft.trim()} onClick={() => {
          const value = draft.trim();
          window[config.auth.tokenStorage].setItem(config.auth.tokenKey, value);
          setToken(value);
        }}>Continue</Button>
      </section>
    </main>;
  }

  return React.cloneElement(children, {
    onLogout: () => {
      window[config.auth.tokenStorage].removeItem(config.auth.tokenKey);
      setToken('');
      setDraft('');
    }
  });
}

function FieldControl({field, value, onChange, error, relationOptions}) {
  const widget = widgetFor(field);
  const common = {
    id: 'field-' + field.name,
    name: field.name,
    disabled: field.readonly,
    'aria-invalid': Boolean(error)
  };

  let control;
  if (widget === 'checkbox') {
    control = <input {...common} type="checkbox" checked={Boolean(value)}
      onChange={event => onChange(event.target.checked)} />;
  } else if (widget === 'textarea') {
    control = <textarea {...common} value={value ?? ''} placeholder={field.placeholder}
      onChange={event => onChange(event.target.value)} rows="4" />;
  } else if (widget === 'select') {
    control = <select {...common} value={value ?? ''} onChange={event => onChange(event.target.value)}>
      <option value="">Select…</option>
      {(field.enum || []).map(option =>
        <option key={String(option)} value={String(option)}>{String(option)}</option>
      )}
    </select>;
  } else if (widget === 'reference' && relationOptions) {
    control = <select {...common} multiple={field.many}
      value={field.many ? (value || []) : (value ?? '')}
      onChange={event => {
        if (field.many) onChange(Array.from(event.target.selectedOptions).map(option => option.value));
        else onChange(event.target.value);
      }}>
      {!field.many && <option value="">Select…</option>}
      {relationOptions.map(option =>
        <option key={option.id} value={option.id}>{option.label}</option>
      )}
    </select>;
  } else {
    const type = widget === 'number' ? 'number'
      : widget === 'date' ? 'date'
      : widget === 'datetime' ? 'datetime-local'
      : 'text';
    control = <input {...common} type={type} value={value ?? ''} placeholder={field.placeholder}
      min={field.min} max={field.max} minLength={field.minLength} maxLength={field.maxLength}
      onChange={event => onChange(event.target.value)} />;
  }

  return <div className={'field ' + (error ? 'field-error' : '')}>
    <label htmlFor={common.id}>{field.label}{field.required ? ' *' : ''}</label>
    {control}
    {field.help && <small>{field.help}</small>}
    {error && <small className="error-text">{error}</small>}
  </div>;
}

function RecordForm({entity, record, api, onSaved, onCancel, notify}) {
  const editing = Boolean(record);
  const [values, setValues] = useState(() => {
    const initial = {};
    for (const field of entity.fields) {
      let value = record ? record[field.name] : field.default;
      if (field.type === 'reference' && value && typeof value === 'object') {
        if (Array.isArray(value)) value = value.map(item => item[idField] || item.id || item._id);
        else value = value[idField] || value.id || value._id;
      }
      if (field.type === 'date' && value) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) value = date.toISOString().slice(0, 16);
      }
      if (field.type === 'boolean' && value === undefined) value = false;
      initial[field.name] = value ?? '';
    }
    return initial;
  });
  const [errors, setErrors] = useState({});
  const [relations, setRelations] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const next = {};
      const referenceFields = entity.fields.filter(field =>
        field.type === 'reference' && !field.hidden && !field.readonly
      );
      for (const field of referenceFields) {
        const target = config.entities.find(item => item.name === field.ref);
        if (!target || !target.operations.list.enabled) continue;
        try {
          const pagination = target.operations.list.query.pagination;
          const query = pagination.enabled
            ? {[pagination.limitParam]: pagination.maxLimit}
            : {};
          const rows = await api.entity(target).list(query);
          next[field.name] = rows.map(row => ({
            id: row[idField],
            label: String(row[target.titleField] ?? row[idField])
          }));
        } catch {
          next[field.name] = null;
        }
      }
      if (active) setRelations(next);
    })();
    return () => { active = false; };
  }, [api, entity]);

  async function submit(event) {
    event.preventDefault();
    const validation = validateValues(entity, values, editing);
    setErrors(validation);
    if (Object.keys(validation).length) return;

    setSaving(true);
    try {
      const payload = payloadFor(entity, values);
      const service = api.entity(entity);
      const saved = editing
        ? await service.update(record[idField], payload)
        : await service.create(payload);
      notify({type: 'success', text: entity.label + (editing ? ' updated' : ' created')});
      onSaved(saved);
    } catch (error) {
      notify({type: 'error', text: error instanceof ApiError ? error.message : String(error.message || error)});
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop">
    <section className="modal" role="dialog" aria-modal="true"
      aria-label={(editing ? 'Edit ' : 'Create ') + entity.label}>
      <div className="modal-header">
        <div>
          <span className="eyebrow">{editing ? 'Edit record' : 'New record'}</span>
          <h2>{entity.label}</h2>
        </div>
        <button className="icon-button" onClick={onCancel} aria-label="Close">×</button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          {entity.fields.filter(field => !field.hidden).map(field =>
            <FieldControl key={field.name} field={field} value={values[field.name]}
              error={errors[field.name]} relationOptions={relations[field.name]}
              onChange={value => setValues(current => ({...current, [field.name]: value}))} />
          )}
        </div>
        <div className="modal-actions">
          <Button type="button" onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </section>
  </div>;
}

function ActionDialog({action, row, api, onClose, notify}) {
  const [body, setBody] = useState('{}');
  const [query, setQuery] = useState('{}');
  const [params, setParams] = useState(() => {
    const initial = {};
    for (const name of action.pathParams) {
      initial[name] = row && action.entityIdParam === name ? row[idField] : '';
    }
    return initial;
  });
  const [running, setRunning] = useState(false);

  async function run(event) {
    event.preventDefault();
    setRunning(true);
    try {
      const result = await api.action(action, {
        params,
        query: query.trim() ? JSON.parse(query) : undefined,
        body: body.trim() ? JSON.parse(body) : undefined
      });
      notify({
        type: 'success',
        text: action.label + ' completed' + (result ? ': ' + JSON.stringify(result) : '')
      });
      onClose(true);
    } catch (error) {
      notify({type: 'error', text: error instanceof ApiError ? error.message : String(error.message || error)});
    } finally {
      setRunning(false);
    }
  }

  return <div className="modal-backdrop">
    <section className="modal" role="dialog" aria-modal="true" aria-label={action.label}>
      <div className="modal-header">
        <div><span className="eyebrow">Custom action</span><h2>{action.label}</h2></div>
        <button className="icon-button" onClick={() => onClose(false)}>×</button>
      </div>
      <form onSubmit={run}>
        {action.pathParams.map(name =>
          <div className="field" key={name}>
            <label htmlFor={'action-' + name}>{name}</label>
            <input id={'action-' + name} value={params[name] ?? ''}
              disabled={Boolean(row && action.entityIdParam === name)}
              onChange={event => setParams(current => ({...current, [name]: event.target.value}))} />
          </div>
        )}
        <div className="field">
          <label htmlFor="action-body">JSON body</label>
          <textarea id="action-body" rows="6" value={body} onChange={event => setBody(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="action-query">JSON query</label>
          <textarea id="action-query" rows="3" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="modal-actions">
          <Button type="button" onClick={() => onClose(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={running}>
            {running ? 'Running…' : 'Run action'}
          </Button>
        </div>
      </form>
    </section>
  </div>;
}

function FilterBar({entity, filters, setFilters, apply, reset}) {
  const sortParam = entity.operations.list.query.sortParam;
  if (!entity.filterFields.length && !sortParam) return null;

  return <form className="filters" onSubmit={event => { event.preventDefault(); apply(); }}>
    {entity.filterFields.map(name => {
      const field = entity.fields.find(item => item.name === name);
      return <div className="filter" key={name}>
        <label htmlFor={'filter-' + entity.name + '-' + name}>{field ? field.label : name}</label>
        <input id={'filter-' + entity.name + '-' + name} value={filters[name] ?? ''}
          onChange={event => setFilters(current => ({...current, [name]: event.target.value}))} />
      </div>;
    })}
    {sortParam && <div className="filter">
      <label htmlFor={'sort-' + entity.name}>Sort</label>
      <select id={'sort-' + entity.name} value={filters[sortParam] ?? ''}
        onChange={event => setFilters(current => ({...current, [sortParam]: event.target.value}))}>
        <option value="">Default</option>
        {entity.listFields.map(name =>
          <React.Fragment key={name}>
            <option value={name}>{name} ↑</option>
            <option value={'-' + name}>{name} ↓</option>
          </React.Fragment>
        )}
      </select>
    </div>}
    <div className="filter-actions">
      <Button type="submit" variant="primary">Apply</Button>
      <Button type="button" onClick={reset}>Reset</Button>
    </div>
  </form>;
}

function EntityPage({entity, api, notify}) {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({});
  const [activeFilters, setActiveFilters] = useState({});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formRecord, setFormRecord] = useState(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [actionState, setActionState] = useState(null);
  const rowActions = config.actions.filter(action => action.entity === entity.name);
  const pagination = entity.operations.list.query.pagination;

  async function load() {
    if (!entity.operations.list.enabled) return;
    setLoading(true);
    try {
      const query = {...activeFilters};
      if (pagination.enabled) {
        query[pagination.pageParam] = page;
        query[pagination.limitParam] = entity.pageSize;
      }
      const data = await api.entity(entity).list(query);
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      notify({type: 'error', text: error instanceof ApiError ? error.message : String(error.message || error)});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [entity.name, activeFilters, page]);

  async function edit(row) {
    if (entity.operations.get.enabled) {
      try {
        const record = await api.entity(entity).get(row[idField]);
        setFormRecord(record);
      } catch (error) {
        notify({type: 'error', text: error instanceof ApiError ? error.message : String(error.message || error)});
        return;
      }
    } else {
      setFormRecord(row);
    }
    setFormOpen(true);
  }

  async function remove(row) {
    const label = row[entity.titleField] ?? row[idField];
    if (!window.confirm('Delete ' + entity.label + ' "' + label + '"?')) return;
    try {
      await api.entity(entity).remove(row[idField]);
      notify({type: 'success', text: entity.label + ' deleted'});
      await load();
    } catch (error) {
      notify({type: 'error', text: error instanceof ApiError ? error.message : String(error.message || error)});
    }
  }

  return <section>
    <div className="page-header">
      <div>
        <span className="eyebrow">Resource</span>
        <h1>{entity.pluralLabel}</h1>
        <p>{loading ? 'Loading…' : rows.length + ' record' + (rows.length === 1 ? '' : 's') + ' on this page'}</p>
      </div>
      {entity.create &&
        <Button variant="primary" onClick={() => { setFormRecord(null); setFormOpen(true); }}>
          + New {entity.label}
        </Button>}
    </div>

    <FilterBar entity={entity} filters={filters} setFilters={setFilters}
      apply={() => { setPage(1); setActiveFilters({...filters}); }}
      reset={() => { setFilters({}); setActiveFilters({}); setPage(1); }} />

    {!entity.operations.list.enabled
      ? <div className="empty">List operation is disabled for this resource.</div>
      : <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead><tr>
                {entity.listFields.map(name => {
                  const field = entity.fields.find(item => item.name === name);
                  return <th key={name}>{field ? field.label : name}</th>;
                })}
                <th className="actions-column">Actions</th>
              </tr></thead>
              <tbody>
                {rows.map(row =>
                  <tr key={row[idField]}>
                    {entity.listFields.map(name => {
                      const field = entity.fields.find(item => item.name === name);
                      return <td key={name}>{humanValue(row[name], field, config.entities)}</td>;
                    })}
                    <td className="row-actions">
                      {entity.edit && <button onClick={() => edit(row)}>Edit</button>}
                      {rowActions.map(action =>
                        <button key={action.name} onClick={() => setActionState({action, row})}>{action.label}</button>
                      )}
                      {entity.delete && <button className="danger-link" onClick={() => remove(row)}>Delete</button>}
                    </td>
                  </tr>
                )}
                {!rows.length && !loading &&
                  <tr><td colSpan={entity.listFields.length + 1}><div className="empty">No records found.</div></td></tr>}
              </tbody>
            </table>
          </div>
          {pagination.enabled &&
            <div className="pagination">
              <Button disabled={page <= 1 || loading}
                onClick={() => setPage(current => Math.max(1, current - 1))}>← Previous</Button>
              <span>Page {page}</span>
              <Button disabled={rows.length < entity.pageSize || loading}
                onClick={() => setPage(current => current + 1)}>Next →</Button>
            </div>}
        </div>}

    {formOpen &&
      <RecordForm entity={entity} record={formRecord} api={api} notify={notify}
        onCancel={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); load(); }} />}

    {actionState &&
      <ActionDialog {...actionState} api={api} notify={notify}
        onClose={refresh => { setActionState(null); if (refresh) load(); }} />}
  </section>;
}

function Dashboard({navigate}) {
  return <section>
    <div className="page-header">
      <div>
        <span className="eyebrow">Overview</span>
        <h1>Dashboard</h1>
        <p>Manage every generated API resource from one place.</p>
      </div>
    </div>
    <div className="resource-grid">
      {config.entities.map(entity =>
        <button className="resource-card" key={entity.name} onClick={() => navigate(entity.name)}>
          <span className="resource-icon">{entity.label.slice(0, 1).toUpperCase()}</span>
          <strong>{entity.pluralLabel}</strong>
          <small>{entity.listFields.length} visible columns · {entity.filterFields.length} filters</small>
        </button>
      )}
    </div>
  </section>;
}

function ActionsPage({api, notify}) {
  const globalActions = config.actions.filter(action => !action.entity);
  const [active, setActive] = useState(null);

  return <section>
    <div className="page-header">
      <div>
        <span className="eyebrow">Workflows</span>
        <h1>Custom actions</h1>
        <p>Run declarative backend workflows that are not bound to a resource row.</p>
      </div>
    </div>
    <div className="resource-grid">
      {globalActions.map(action =>
        <button className="resource-card" key={action.name} onClick={() => setActive(action)}>
          <span className="resource-icon">↗</span>
          <strong>{action.label}</strong>
          <small>{action.method} {action.path}</small>
        </button>
      )}
      {!globalActions.length && <div className="empty">All custom actions are attached to resource rows.</div>}
    </div>
    {active &&
      <ActionDialog action={active} api={api} notify={notify} onClose={() => setActive(null)} />}
  </section>;
}

function Shell({onLogout}) {
  const initial = window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [route, setRoute] = useState(initial);
  const [toast, setToast] = useState(null);
  const api = useMemo(() => createApi(config, {
    baseUrl: import.meta.env.VITE_API_BASE_URL || config.baseUrl
  }), []);

  useEffect(() => {
    const handler = () => setRoute(window.location.hash.replace(/^#\/?/, '') || 'dashboard');
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  function navigate(next) {
    window.location.hash = next === 'dashboard' ? '#/' : '#/' + next;
  }

  const entity = config.entities.find(item => item.name === route || item.route === route);
  const showGlobalActions = config.actions.some(action => !action.entity);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">J2E</div>
        <div><strong>{config.title}</strong><small>Generated admin</small></div>
      </div>
      <nav>
        <button className={route === 'dashboard' ? 'active' : ''} onClick={() => navigate('dashboard')}>Overview</button>
        <div className="nav-label">Resources</div>
        {config.entities.map(item =>
          <button key={item.name} className={entity && entity.name === item.name ? 'active' : ''}
            onClick={() => navigate(item.name)}>{item.pluralLabel}</button>
        )}
        {showGlobalActions &&
          <>
            <div className="nav-label">Workflows</div>
            <button className={route === 'actions' ? 'active' : ''} onClick={() => navigate('actions')}>Custom actions</button>
          </>}
      </nav>
      <div className="sidebar-footer">
        {config.authEnabled && <Button onClick={onLogout}>Clear token</Button>}
        <small>{config.databaseType === 'postgresql' ? 'PostgreSQL / Prisma' : 'MongoDB / Mongoose'}</small>
      </div>
    </aside>

    <main className="content">
      {route === 'dashboard' && <Dashboard navigate={navigate} />}
      {route === 'actions' && <ActionsPage api={api} notify={setToast} />}
      {entity && <EntityPage key={entity.name} entity={entity} api={api} notify={setToast} />}
      {!entity && !['dashboard', 'actions'].includes(route) &&
        <div className="empty">Unknown admin route.</div>}
    </main>

    <Toast message={toast} onClose={() => setToast(null)} />
  </div>;
}

export default function App() {
  return <TokenGate><Shell /></TokenGate>;
}
