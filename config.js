(function () {
  var defaultApi = 'http://127.0.0.1:8787';
  var defaultWs = 'ws://127.0.0.1:8787';
  var params = new URLSearchParams(window.location.search);
  var apiParam = (params.get('api') || '').trim();
  var wsParam = (params.get('ws') || '').trim();
  var runtime = window.QUIZ_RUNTIME_CONFIG || {};
  var runtimeApi = (runtime.api || '').trim();
  var runtimeWs = (runtime.ws || '').trim();
  var storedApi = (localStorage.getItem('quiz_api_base') || '').trim();
  var storedWs = (localStorage.getItem('quiz_ws_base') || '').trim();
  var source = 'default';
  var api = defaultApi;
  var ws = defaultWs;

  function deriveWsFromApi(apiUrl) {
    return apiUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  }

  function deriveApiFromWs(wsUrl) {
    return wsUrl.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
  }

  if (apiParam && !wsParam) {
    wsParam = deriveWsFromApi(apiParam);
  }
  if (wsParam && !apiParam) {
    apiParam = deriveApiFromWs(wsParam);
  }
  if (runtimeApi && !runtimeWs) {
    runtimeWs = deriveWsFromApi(runtimeApi);
  }
  if (runtimeWs && !runtimeApi) {
    runtimeApi = deriveApiFromWs(runtimeWs);
  }
  if (storedApi && !storedWs) {
    storedWs = deriveWsFromApi(storedApi);
  }
  if (storedWs && !storedApi) {
    storedApi = deriveApiFromWs(storedWs);
  }

  if (runtimeApi && runtimeWs) {
    api = runtimeApi;
    ws = runtimeWs;
    source = 'runtime';
  } else if (apiParam && wsParam) {
    api = apiParam;
    ws = wsParam;
    source = 'query';
  } else if (storedApi && storedWs) {
    api = storedApi;
    ws = storedWs;
    source = 'storage';
  }

  localStorage.setItem('quiz_api_base', api);
  localStorage.setItem('quiz_ws_base', ws);

  window.QUIZ_CONFIG = {
    API_BASE_URL: api,
    WS_BASE_URL: ws,
    SOURCE: source,
    UPDATED_AT: runtime.updatedAt || null,
  };
})();
