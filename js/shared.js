(function () {
  function trimTrailingSlash(value) {
    return value.replace(/\/+$/, '');
  }

  function getApiBase() {
    return trimTrailingSlash(window.QUIZ_CONFIG.API_BASE_URL);
  }

  function getWsBase() {
    return trimTrailingSlash(window.QUIZ_CONFIG.WS_BASE_URL);
  }

  async function apiFetch(path, options) {
    var request = Object.assign({ method: 'GET', headers: {} }, options || {});
    if (request.body && typeof request.body === 'object') {
      request.headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }

    var response = await fetch(getApiBase() + path, request);
    var contentType = response.headers.get('content-type') || '';
    var payload;
    if (contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      payload = await response.text();
    }

    if (!response.ok) {
      var detail = payload && payload.detail ? payload.detail : String(payload);
      throw new Error(detail || ('HTTP ' + response.status));
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
      .replace(/"/g, '&quot;')
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
  };
})();
