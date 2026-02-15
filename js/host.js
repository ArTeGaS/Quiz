(function () {
  var shared = window.quizShared;
  var STORAGE = {
    sessionId: 'quiz_host_session_id',
    hostToken: 'quiz_host_token',
    sessionCode: 'quiz_host_code',
  };

  var state = {
    sessionId: null,
    hostToken: null,
    sessionCode: null,
    ws: null,
    leaderboard: [],
    participants: [],
    status: 'lobby',
    totalQuestions: 0,
  };

  var el = {
    titleInput: document.getElementById('titleInput'),
    hostNameInput: document.getElementById('hostNameInput'),
    questionsInput: document.getElementById('questionsInput'),
    createBtn: document.getElementById('createBtn'),
    loadSampleBtn: document.getElementById('loadSampleBtn'),
    clearSavedBtn: document.getElementById('clearSavedBtn'),
    createStatus: document.getElementById('createStatus'),
    sessionCode: document.getElementById('sessionCode'),
    joinLink: document.getElementById('joinLink'),
    copyJoinLinkBtn: document.getElementById('copyJoinLinkBtn'),
    sessionStatus: document.getElementById('sessionStatus'),
    startBtn: document.getElementById('startBtn'),
    nextBtn: document.getElementById('nextBtn'),
    finishBtn: document.getElementById('finishBtn'),
    questionStatus: document.getElementById('questionStatus'),
    participantsList: document.getElementById('participantsList'),
    leaderboardTable: document.querySelector('#leaderboardTable tbody'),
    log: document.getElementById('log'),
    reportLinks: document.getElementById('reportLinks'),
  };

  var sampleQuestions = [
    {
      prompt: 'Що виведе Python: print(2 ** 3)?',
      options: ['5', '6', '8', '9'],
      correctIndex: 2,
      timeLimitSec: 15,
    },
    {
      prompt: 'Який тип має значення 3.14?',
      options: ['int', 'float', 'str', 'bool'],
      correctIndex: 1,
      timeLimitSec: 15,
    },
    {
      prompt: 'Який цикл використовують, коли кількість повторів невідома?',
      options: ['for', 'while', 'switch', 'repeat'],
      correctIndex: 1,
      timeLimitSec: 20,
    },
  ];

  function setDefaultQuestions() {
    el.questionsInput.value = JSON.stringify(sampleQuestions, null, 2);
  }

  function log(message) {
    var line = '[' + shared.formatTime(new Date()) + '] ' + message;
    el.log.textContent = line + '\n' + el.log.textContent;
  }

  function setStatus(status) {
    state.status = status;
    el.sessionStatus.textContent = status;
  }

  function setButtonsState() {
    var hasSession = Boolean(state.sessionId && state.hostToken);
    el.startBtn.disabled = !hasSession || state.status === 'active' || state.status === 'finished';
    el.nextBtn.disabled = !hasSession || state.status !== 'active';
    el.finishBtn.disabled = !hasSession || state.status === 'finished';
    el.copyJoinLinkBtn.disabled = !hasSession;
  }

  function buildPlayerLink() {
    if (!state.sessionCode) {
      return null;
    }
    var url = new URL('./player.html', window.location.href);
    url.searchParams.set('code', state.sessionCode);
    url.searchParams.set('api', shared.getApiBase());
    url.searchParams.set('ws', shared.getWsBase());
    return url.toString();
  }

  function updateJoinLink() {
    var link = buildPlayerLink();
    if (!link) {
      el.joinLink.href = '#';
      el.joinLink.textContent = "з'явиться після створення сесії";
      return;
    }
    el.joinLink.href = link;
    el.joinLink.textContent = link;
  }

  async function copyJoinLink() {
    var link = buildPlayerLink();
    if (!link) {
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      el.createStatus.textContent = 'Лінк для Player скопійовано.';
      log('Скопійовано лінк для Player.');
    } catch (error) {
      el.createStatus.textContent = 'Не вдалося скопіювати лінк. Скопіюй вручну.';
      log('Clipboard недоступний: ' + error.message);
    }
  }

  function persistHostSession() {
    if (!state.sessionId || !state.hostToken || !state.sessionCode) {
      return;
    }
    localStorage.setItem(STORAGE.sessionId, state.sessionId);
    localStorage.setItem(STORAGE.hostToken, state.hostToken);
    localStorage.setItem(STORAGE.sessionCode, state.sessionCode);
  }

  function clearSavedSession() {
    localStorage.removeItem(STORAGE.sessionId);
    localStorage.removeItem(STORAGE.hostToken);
    localStorage.removeItem(STORAGE.sessionCode);
  }

  function showReportLinks() {
    if (!state.sessionId) {
      el.reportLinks.innerHTML = '';
      return;
    }
    var api = shared.getApiBase();
    el.reportLinks.innerHTML =
      'Звіт: <a href="' + api + '/api/host/sessions/' + state.sessionId + '/report" target="_blank">JSON</a> | ' +
      '<a href="' + api + '/api/host/sessions/' + state.sessionId + '/report.csv" target="_blank">CSV</a>';
  }

  function renderParticipants(items) {
    state.participants = items || [];
    el.participantsList.innerHTML = '';
    if (!state.participants.length) {
      el.participantsList.innerHTML = '<li class="small">Поки нікого.</li>';
      return;
    }

    state.participants.forEach(function (item) {
      var li = document.createElement('li');
      li.textContent = item.nickname;
      el.participantsList.appendChild(li);
    });
  }

  function renderLeaderboard(items) {
    state.leaderboard = items || [];
    el.leaderboardTable.innerHTML = '';
    if (!state.leaderboard.length) {
      el.leaderboardTable.innerHTML = '<tr><td colspan="3" class="small">Немає даних</td></tr>';
      return;
    }

    state.leaderboard.forEach(function (item) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + item.rank + '</td>' +
        '<td>' + shared.escapeHtml(item.nickname) + '</td>' +
        '<td>' + item.score + '</td>';
      el.leaderboardTable.appendChild(tr);
    });
  }

  function setQuestionStatusFromState(syncState) {
    if (syncState.currentQuestion) {
      el.questionStatus.textContent =
        'Питання ' + (syncState.currentQuestion.questionIndex + 1) +
        '/' + (syncState.currentQuestion.totalQuestions || state.totalQuestions);
      return;
    }
    if (state.status === 'lobby') {
      el.questionStatus.textContent = 'Очікування старту';
    } else if (state.status === 'active') {
      el.questionStatus.textContent = 'Гра активна. Чекає запуску наступного питання.';
    } else if (state.status === 'finished') {
      el.questionStatus.textContent = 'Сесію завершено';
    }
  }

  function connectWs() {
    if (!state.hostToken) return;
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }

    state.ws = shared.createWs(state.hostToken);
    state.ws.onopen = function () {
      log('WS підключено');
    };
    state.ws.onclose = function () {
      log('WS відключено');
    };
    state.ws.onerror = function () {
      log('WS помилка');
    };
    state.ws.onmessage = function (event) {
      var msg = JSON.parse(event.data);
      handleEvent(msg.event, msg.data || {});
    };
  }

  function handleEvent(event, data) {
    switch (event) {
      case 'sync_state': {
        state.sessionId = data.sessionId || state.sessionId;
        state.sessionCode = data.sessionCode || state.sessionCode;
        state.totalQuestions = data.totalQuestions || state.totalQuestions;
        setStatus(data.status || state.status);
        persistHostSession();
        el.sessionCode.textContent = state.sessionCode || '------';
        updateJoinLink();
        renderParticipants(data.participants || []);
        renderLeaderboard(data.leaderboard || []);
        setQuestionStatusFromState(data);
        if (state.status === 'finished') {
          showReportLinks();
        }
        setButtonsState();
        break;
      }
      case 'participant_joined': {
        if (data.participants) renderParticipants(data.participants);
        if (data.leaderboard) renderLeaderboard(data.leaderboard);
        log('Підключився: ' + (data.nickname || 'учасник'));
        break;
      }
      case 'session_state': {
        setStatus(data.status || state.status);
        setButtonsState();
        log('Статус: ' + state.status);
        if (state.status === 'finished') {
          showReportLinks();
        }
        break;
      }
      case 'question_open': {
        el.questionStatus.textContent =
          'Відкрите питання ' + (data.questionIndex + 1) +
          '/' + (data.totalQuestions || state.totalQuestions) +
          ' (ліміт ' + data.timeLimitSec + 'с)';
        log('Відкрито питання #' + (data.questionIndex + 1));
        break;
      }
      case 'question_result': {
        if (data.leaderboard) renderLeaderboard(data.leaderboard);
        el.questionStatus.textContent =
          'Питання #' + (data.questionIndex + 1) +
          ' завершено. Правильна відповідь: варіант ' + (data.correctIndex + 1);
        log('Результати питання #' + (data.questionIndex + 1));
        break;
      }
      case 'leaderboard_update': {
        if (data.leaderboard) renderLeaderboard(data.leaderboard);
        break;
      }
      case 'session_finished': {
        if (data.leaderboard) renderLeaderboard(data.leaderboard);
        setStatus('finished');
        setButtonsState();
        el.questionStatus.textContent = 'Сесію завершено';
        showReportLinks();
        log('Сесію завершено');
        break;
      }
      case 'answer_ack':
      case 'pong':
        break;
      default:
        log('Подія: ' + event);
    }
  }

  async function createSession() {
    el.createStatus.textContent = '';
    try {
      var payload = {
        title: el.titleInput.value,
        hostName: el.hostNameInput.value,
      };
      var rawQuestions = el.questionsInput.value.trim();
      if (rawQuestions) {
        payload.questions = JSON.parse(rawQuestions);
      }

      var result = await shared.apiFetch('/api/host/sessions', {
        method: 'POST',
        body: payload,
      });

      state.sessionId = result.sessionId;
      state.sessionCode = result.sessionCode;
      state.hostToken = result.hostToken;
      state.totalQuestions = result.totalQuestions;
      setStatus(result.status);
      persistHostSession();
      el.sessionCode.textContent = state.sessionCode;
      updateJoinLink();
      el.createStatus.textContent = 'Сесію створено.';
      setButtonsState();
      connectWs();
      log('Створено сесію з кодом ' + state.sessionCode);
    } catch (error) {
      el.createStatus.textContent = 'Помилка: ' + error.message;
      log('Помилка створення: ' + error.message);
    }
  }

  async function hostAction(path) {
    if (!state.sessionId || !state.hostToken) return;
    try {
      await shared.apiFetch(path, shared.withAuth(state.hostToken, { method: 'POST' }));
    } catch (error) {
      log('Помилка: ' + error.message);
    }
  }

  async function restoreSavedSession() {
    var savedSessionId = localStorage.getItem(STORAGE.sessionId);
    var savedToken = localStorage.getItem(STORAGE.hostToken);
    var savedCode = localStorage.getItem(STORAGE.sessionCode);

    if (!savedSessionId || !savedToken || !savedCode) {
      return;
    }

    state.sessionId = savedSessionId;
    state.hostToken = savedToken;
    state.sessionCode = savedCode;
    el.sessionCode.textContent = savedCode;
    updateJoinLink();
    setButtonsState();

    try {
      var statePayload = await shared.apiFetch(
        '/api/host/sessions/' + state.sessionId + '/state',
        shared.withAuth(state.hostToken, { method: 'GET' })
      );
      state.totalQuestions = statePayload.totalQuestions || 0;
      setStatus(statePayload.status || 'lobby');
      renderParticipants(statePayload.participants || []);
      renderLeaderboard(statePayload.leaderboard || []);
      setQuestionStatusFromState(statePayload);
      if (state.status === 'finished') {
        showReportLinks();
      }
      connectWs();
      log('Відновлено host-сесію: ' + savedCode);
    } catch (error) {
      clearSavedSession();
      state.sessionId = null;
      state.hostToken = null;
      state.sessionCode = null;
      setStatus('lobby');
      setButtonsState();
      el.sessionCode.textContent = '------';
      updateJoinLink();
      el.createStatus.textContent = 'Збережену сесію не вдалося відновити: ' + error.message;
      log('Не відновлено збережену сесію: ' + error.message);
    }
  }

  el.createBtn.addEventListener('click', function () {
    createSession();
  });

  el.loadSampleBtn.addEventListener('click', function () {
    setDefaultQuestions();
  });

  el.copyJoinLinkBtn.addEventListener('click', function () {
    copyJoinLink();
  });

  el.clearSavedBtn.addEventListener('click', function () {
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }
    clearSavedSession();
    state.sessionId = null;
    state.hostToken = null;
    state.sessionCode = null;
    state.totalQuestions = 0;
    setStatus('lobby');
    setButtonsState();
    el.sessionCode.textContent = '------';
    updateJoinLink();
    el.questionStatus.textContent = 'Очікування старту';
    el.reportLinks.innerHTML = '';
    renderParticipants([]);
    renderLeaderboard([]);
    el.createStatus.textContent = 'Збережену host-сесію очищено.';
    log('Очищено збережені дані host-сесії.');
  });

  el.startBtn.addEventListener('click', function () {
    hostAction('/api/host/sessions/' + state.sessionId + '/start');
  });

  el.nextBtn.addEventListener('click', function () {
    hostAction('/api/host/sessions/' + state.sessionId + '/next');
  });

  el.finishBtn.addEventListener('click', function () {
    hostAction('/api/host/sessions/' + state.sessionId + '/finish');
  });

  setDefaultQuestions();
  setButtonsState();
  updateJoinLink();
  restoreSavedSession();
  log('Готово. Створи сесію або віднови збережену.');
})();
