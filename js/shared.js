(function () {
  var runtimeSyncState = {
    inFlight: null,
    lastAttemptMs: 0,
  };

  function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function getApiBase() {
    return trimTrailingSlash(window.QUIZ_CONFIG.API_BASE_URL);
  }

  function getWsBase() {
    return trimTrailingSlash(window.QUIZ_CONFIG.WS_BASE_URL);
  }

  function parseRuntimeConfigScript(text) {
    var apiMatch = text.match(/api:\s*'([^']+)'/);
    var wsMatch = text.match(/ws:\s*'([^']+)'/);
    if (!apiMatch || !wsMatch) {
      return null;
    }
    return {
      api: apiMatch[1].trim(),
      ws: wsMatch[1].trim(),
    };
  }

  function applyRuntimeConfig(runtime) {
    if (!runtime || !runtime.api || !runtime.ws) {
      return false;
    }

    if (!window.QUIZ_CONFIG) {
      window.QUIZ_CONFIG = {
        API_BASE_URL: runtime.api,
        WS_BASE_URL: runtime.ws,
        SOURCE: 'runtime-live',
        UPDATED_AT: new Date().toISOString(),
      };
    }

    var nextApi = trimTrailingSlash(runtime.api);
    var nextWs = trimTrailingSlash(runtime.ws);
    var changed =
      nextApi !== trimTrailingSlash(window.QUIZ_CONFIG.API_BASE_URL) ||
      nextWs !== trimTrailingSlash(window.QUIZ_CONFIG.WS_BASE_URL);

    window.QUIZ_CONFIG.API_BASE_URL = nextApi;
    window.QUIZ_CONFIG.WS_BASE_URL = nextWs;
    window.QUIZ_CONFIG.SOURCE = 'runtime-live';
    window.QUIZ_CONFIG.UPDATED_AT = new Date().toISOString();

    localStorage.setItem('quiz_api_base', nextApi);
    localStorage.setItem('quiz_ws_base', nextWs);
    return changed;
  }

  async function syncRuntimeConfig(force) {
    var now = Date.now();
    if (!force && now - runtimeSyncState.lastAttemptMs < 3000) {
      return false;
    }
    runtimeSyncState.lastAttemptMs = now;

    if (runtimeSyncState.inFlight) {
      return runtimeSyncState.inFlight;
    }

    runtimeSyncState.inFlight = (async function () {
      var response = await fetch('./runtime-config.js?v=' + Date.now(), {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('runtime-config HTTP ' + response.status);
      }
      var text = await response.text();
      var parsed = parseRuntimeConfigScript(text);
      if (!parsed) {
        throw new Error('runtime-config parse failed');
      }
      return applyRuntimeConfig(parsed);
    })().finally(function () {
      runtimeSyncState.inFlight = null;
    });

    return runtimeSyncState.inFlight;
  }

  async function apiFetch(path, options) {
    try {
      await syncRuntimeConfig(false);
    } catch (error) {}

    var request = Object.assign({ method: 'GET', headers: {} }, options || {});
    request.headers = Object.assign({}, request.headers || {}, {
      'ngrok-skip-browser-warning': 'true',
    });
    if (request.body && typeof request.body === 'object') {
      request.headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }

    var url = getApiBase() + path;
    var response;
    try {
      response = await fetch(url, request);
    } catch (error) {
      try {
        await syncRuntimeConfig(true);
      } catch (syncError) {}

      var retryUrl = getApiBase() + path;
      try {
        response = await fetch(retryUrl, request);
        url = retryUrl;
      } catch (retryError) {
        var source = (window.QUIZ_CONFIG && window.QUIZ_CONFIG.SOURCE) || 'unknown';
        throw new Error('Failed to fetch [' + retryUrl + '] (source=' + source + ')');
      }
    }

    if (!response.ok && response.status >= 500) {
      try {
        await syncRuntimeConfig(true);
        var failoverUrl = getApiBase() + path;
        if (failoverUrl !== url) {
          response = await fetch(failoverUrl, request);
          url = failoverUrl;
        }
      } catch (error) {}
    }

    var contentType = response.headers.get('content-type') || '';
    var payload;
    if (contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      payload = await response.text();
    }

    if (!response.ok) {
      var detail = payload && payload.detail ? payload.detail : String(payload);
      throw new Error((detail || ('HTTP ' + response.status)) + ' [' + url + ']');
    }
    return payload;
  }

  function withAuth(token, options) {
    var request = Object.assign({ headers: {} }, options || {});
    request.headers = Object.assign({}, request.headers || {}, {
      Authorization: 'Bearer ' + token,
    });
    return request;
  }

  function createWs(token) {
    return new WebSocket(getWsBase() + '/ws?token=' + encodeURIComponent(token));
  }

  function formatTime(date) {
    var d = date instanceof Date ? date : new Date(date);
    return d.toLocaleTimeString();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window.quizShared = {
    apiFetch: apiFetch,
    withAuth: withAuth,
    createWs: createWs,
    formatTime: formatTime,
    escapeHtml: escapeHtml,
    getApiBase: getApiBase,
    getWsBase: getWsBase,
    syncRuntimeConfig: syncRuntimeConfig,
  };
})();
