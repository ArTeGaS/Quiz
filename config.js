(function () {
  var defaultApi = 'http://127.0.0.1:8787';
  var defaultWs = 'ws://127.0.0.1:8787';
  var params = new URLSearchParams(window.location.search);
  var apiParam = (params.get('api') || '').trim();
  var wsParam = (params.get('ws') || '').trim();

  if (apiParam) {
    localStorage.setItem('quiz_api_base', apiParam);
  }
  if (wsParam) {
    localStorage.setItem('quiz_ws_base', wsParam);
  }

  window.QUIZ_CONFIG = {
    API_BASE_URL: apiParam || localStorage.getItem('quiz_api_base') || defaultApi,
    WS_BASE_URL: wsParam || localStorage.getItem('quiz_ws_base') || defaultWs,
  };
})();
