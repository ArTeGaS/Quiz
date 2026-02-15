(function () {
  var defaultApi = 'http://127.0.0.1:8787';
  var defaultWs = 'ws://127.0.0.1:8787';

  window.QUIZ_CONFIG = {
    API_BASE_URL: localStorage.getItem('quiz_api_base') || defaultApi,
    WS_BASE_URL: localStorage.getItem('quiz_ws_base') || defaultWs,
  };
})();
