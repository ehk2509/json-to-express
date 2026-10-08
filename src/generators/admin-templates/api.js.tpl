export class ApiError extends Error {
  constructor(message, status, body, response) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.response = response;
  }
}

function buildPath(template, params = {}) {
  return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
    const value = params[name];
    if (value === undefined || value === null || value === '') {
      throw new Error('Missing path parameter: ' + name);
    }
    return encodeURIComponent(String(value));
  });
}

function appendQuery(url, query = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) search.set(key, value.join(','));
    else search.set(key, String(value));
  }
  const text = search.toString();
  return text ? url + (url.includes('?') ? '&' : '?') + text : url;
}

export function createApi(config, options = {}) {
  const baseUrl = String(options.baseUrl || config.baseUrl || '').replace(/\/$/, '');
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  function token() {
    if (typeof options.getToken === 'function') return options.getToken();
    if (options.token !== undefined) return options.token;
    if (!config.authEnabled || typeof window === 'undefined') return undefined;
    const storage = window[config.auth.tokenStorage];
    return storage ? storage.getItem(config.auth.tokenKey) || undefined : undefined;
  }

  async function request(method, route, requestOptions = {}) {
    const headers = {...(requestOptions.headers || {})};
    const authToken = await token();
    if (authToken) headers.authorization = 'Bearer ' + authToken;

    let body;
    if (requestOptions.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      headers['content-type'] = headers['content-type'] || 'application/json';
      body = headers['content-type'].includes('application/json')
        ? JSON.stringify(requestOptions.body)
        : requestOptions.body;
    }

    const response = await fetchImpl(
      appendQuery(baseUrl + buildPath(route, requestOptions.params), requestOptions.query),
      {method, headers, body, signal: requestOptions.signal}
    );

    if (response.status === 204) {
      if (!response.ok) throw new ApiError('HTTP ' + response.status, response.status, undefined, response);
      return undefined;
    }

    const text = await response.text();
    let parsed = text;
    if (text) {
      try { parsed = JSON.parse(text); } catch {}
    } else parsed = undefined;

    if (!response.ok) {
      const message = parsed && typeof parsed === 'object' && parsed.error
        ? String(parsed.error)
        : 'HTTP ' + response.status;
      throw new ApiError(message, response.status, parsed, response);
    }
    return parsed;
  }

  function entity(resource) {
    const operations = resource.operations;
    return {
      list(query, requestOptions = {}) {
        if (!operations.list.enabled) throw new Error(resource.name + ' list operation is disabled');
        return request(operations.list.method, operations.list.path, {...requestOptions, query});
      },
      get(id, requestOptions = {}) {
        if (!operations.get.enabled) throw new Error(resource.name + ' get operation is disabled');
        return request(operations.get.method, operations.get.path, {
          ...requestOptions,
          params: {[resource.idParam]: id}
        });
      },
      create(data, requestOptions = {}) {
        if (!operations.create.enabled) throw new Error(resource.name + ' create operation is disabled');
        return request(operations.create.method, operations.create.path, {...requestOptions, body: data});
      },
      update(id, data, requestOptions = {}) {
        if (!operations.update.enabled) throw new Error(resource.name + ' update operation is disabled');
        return request(operations.update.method, operations.update.path, {
          ...requestOptions,
          params: {[resource.idParam]: id},
          body: data
        });
      },
      remove(id, requestOptions = {}) {
        if (!operations.delete.enabled) throw new Error(resource.name + ' delete operation is disabled');
        return request(operations.delete.method, operations.delete.path, {
          ...requestOptions,
          params: {[resource.idParam]: id}
        });
      }
    };
  }

  function action(actionConfig, input = {}, requestOptions = {}) {
    return request(actionConfig.method, actionConfig.path, {
      ...requestOptions,
      params: input.params,
      query: input.query,
      body: input.body
    });
  }

  return {request, entity, action};
}
