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

  function storage() {
    if (typeof window === 'undefined') return null;
    return window[config.auth.tokenStorage] || null;
  }

  function token() {
    if (typeof options.getToken === 'function') return options.getToken();
    if (options.token !== undefined) return options.token;
    if (!config.authEnabled) return undefined;
    const target = storage();
    return target ? target.getItem(config.auth.tokenKey) || undefined : undefined;
  }

  function apiKey() {
    if (typeof options.getApiKey === 'function') return options.getApiKey();
    if (options.apiKey !== undefined) return options.apiKey;
    if (!config.authEnabled) return undefined;
    const target = storage();
    return target ? target.getItem(config.auth.tokenKey + '-api-key') || undefined : undefined;
  }

  function persistToken(value) {
    const target = storage();
    if (!target) return;
    if (value) target.setItem(config.auth.tokenKey, value);
    else target.removeItem(config.auth.tokenKey);
  }

  function persistApiKey(value) {
    const target = storage();
    if (!target) return;
    if (value) target.setItem(config.auth.tokenKey + '-api-key', value);
    else target.removeItem(config.auth.tokenKey + '-api-key');
  }

  async function request(method, route, requestOptions = {}) {
    const headers = {...(requestOptions.headers || {})};
    const authToken = await token();
    if (authToken) headers.authorization = 'Bearer ' + authToken;
    const authApiKey = await apiKey();
    if (authApiKey && config.authBackend.apiKey.enabled) headers[config.authBackend.apiKey.header] = authApiKey;

    let body;
    if (requestOptions.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      headers['content-type'] = headers['content-type'] || 'application/json';
      body = headers['content-type'].includes('application/json')
        ? JSON.stringify(requestOptions.body)
        : requestOptions.body;
    }

    const response = await fetchImpl(
      appendQuery(baseUrl + buildPath(route, requestOptions.params), requestOptions.query),
      {method, headers, body, signal: requestOptions.signal, credentials: 'include'}
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

  async function login(email, password) {
    if (!config.authBackend.local.enabled) throw new Error('Local login is not enabled');
    const result = await request('POST', config.authBackend.local.loginPath, {body: {email, password}});
    if (result && result.accessToken) persistToken(result.accessToken);
    return result;
  }

  async function logout() {
    if (config.authBackend.local.logoutPath) {
      try { await request('POST', config.authBackend.local.logoutPath); } catch {}
    }
    persistToken('');
    persistApiKey('');
  }

  return {
    request, entity, action,
    auth: {login, logout, persistToken, persistApiKey, token, apiKey}
  };
}
