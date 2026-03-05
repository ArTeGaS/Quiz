(function () {
  var shared = window.quizShared;
  var STORAGE = {
    sessionId: 'quiz_host_session_id',
    hostToken: 'quiz_host_token',
    sessionCode: 'quiz_host_code',
  };

  var DEFAULT_SESSION_TITLE = 'Quiz Live';
  var DEFAULT_HOST_NAME = 'Teacher';

  var FALLBACK_MODES = [
    {
      id: 'classic',
      title: 'Класичний квіз',
      subtitle: 'Швидкість + точність',
      description: 'Класичний формат: відповідай швидко та набирай більше балів.',
      unlockScore: 0,
      hasMiniGame: false,
    },
    {
      id: 'archaeology',
      title: 'Команда археологів',
      subtitle: 'Квіз + міні-експедиція',
      description: 'Відповіді відкривають доступ до короткої місії археологічної команди.',
      unlockScore: 1200,
      hasMiniGame: true,
    },
  ];

  var state = {
    sessionId: null,
    hostToken: null,
    sessionCode: null,
    sessionQuizId: null,
    gameMode: 'classic',
    modeMeta: null,
    ws: null,
    leaderboard: [],
    participants: [],
    status: 'lobby',
    totalQuestions: 0,
    modes: FALLBACK_MODES.slice(),
    quizzes: [],
    selectedMode: 'classic',
    selectedQuizId: null,
    setupLocked: false,
  };

  var el = {
    createBtn: document.getElementById('createBtn'),
    clearSavedBtn: document.getElementById('clearSavedBtn'),
    createStatus: document.getElementById('createStatus'),
    sessionCode: document.getElementById('sessionCode'),
    sessionStatus: document.getElementById('sessionStatus'),
    sessionMeta: document.getElementById('sessionMeta'),
    startBtn: document.getElementById('startBtn'),
    nextBtn: document.getElementById('nextBtn'),
    finishBtn: document.getElementById('finishBtn'),
    questionStatus: document.getElementById('questionStatus'),
    participantsList: document.getElementById('participantsList'),
    leaderboardSection: document.getElementById('leaderboardSection'),
    leaderboardTable: document.querySelector('#leaderboardTable tbody'),
    reportLinks: document.getElementById('reportLinks'),
    modeCards: document.getElementById('modeCards'),
    modeHint: document.getElementById('modeHint'),
    quizSelect: document.getElementById('quizSelect'),
    refreshQuizzesBtn: document.getElementById('refreshQuizzesBtn'),
    quizFileInput: document.getElementById('quizFileInput'),
    uploadQuizBtn: document.getElementById('uploadQuizBtn'),
    quizLibraryStatus: document.getElementById('quizLibraryStatus'),
  };

  function log() {
    // UI log intentionally disabled.
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getModeSvg(modeId) {
    if (modeId === 'archaeology') {
      return (
        '<svg viewBox="0 0 140 80" aria-hidden="true">' +
        '<defs><linearGradient id="archGlow" x1="0" x2="1"><stop offset="0%" stop-color="#6b2eb0"/><stop offset="100%" stop-color="#d88bff"/></linearGradient></defs>' +
        '<rect x="4" y="44" width="132" height="30" rx="10" fill="#2a1b3f"/>' +
        '<circle cx="34" cy="38" r="14" fill="#1a1228" stroke="url(#archGlow)" stroke-width="3" class="mode-icon-pulse"/>' +
        '<path d="M34 28 L40 38 L34 48 L28 38 Z" fill="#f3d08f"/>' +
        '<rect x="62" y="24" width="14" height="28" rx="4" fill="#8f5bcc"/>' +
        '<rect x="80" y="30" width="42" height="10" rx="5" fill="#c57cff"/>' +
        '</svg>'
      );
    }

    return (
      '<svg viewBox="0 0 140 80" aria-hidden="true">' +
      '<defs><linearGradient id="classicGlow" x1="0" x2="1"><stop offset="0%" stop-color="#9047e8"/><stop offset="100%" stop-color="#d59dff"/></linearGradient></defs>' +
      '<rect x="4" y="46" width="132" height="26" rx="10" fill="#291b3d"/>' +
      '<path d="M34 22 h72 v18 a16 16 0 0 1 -16 16 h-40 a16 16 0 0 1 -16 -16 z" fill="url(#classicGlow)" class="mode-icon-float"/>' +
      '<circle cx="70" cy="31" r="7" fill="#f9e3ff"/>' +
      '<path d="M70 26 l2 4 h4 l-3.2 2.5 1.3 4 -4.1-2.4 -4.1 2.4 1.3-4 -3.2-2.5 h4z" fill="#7d3cc7"/>' +
      '</svg>'
    );
  }

  function getModeById(modeId) {
    for (var i = 0; i < state.modes.length; i += 1) {
      if (state.modes[i].id === modeId) {
        return state.modes[i];
      }
    }
    return state.modes[0] || FALLBACK_MODES[0];
  }

  function getQuizById(quizId) {
    for (var i = 0; i < state.quizzes.length; i += 1) {
      if (state.quizzes[i].id === quizId) {
        return state.quizzes[i];
      }
    }
    return null;
  }

  function updateLeaderboardVisibility() {
    if (!el.leaderboardSection) {
      return;
    }
    el.leaderboardSection.style.display = state.status === 'finished' ? 'block' : 'none';
  }

  function setStatus(status) {
    state.status = status;
    el.sessionStatus.textContent = status;
    updateLeaderboardVisibility();
  }

  function renderSessionMeta() {
    var mode = getModeById(state.gameMode || state.selectedMode);
    var quiz = getQuizById(state.sessionQuizId || state.selectedQuizId);
    var modeTitle = mode ? mode.title : 'Невідомий режим';
    var quizTitle = quiz ? quiz.name : 'Квіз не обрано';
    el.sessionMeta.textContent = 'Режим: ' + modeTitle + ' | Квіз: ' + quizTitle;
  }

  function setButtonsState() {
    var hasSession = Boolean(state.sessionId && state.hostToken);
    el.createBtn.disabled = state.setupLocked || !state.selectedQuizId;
    el.startBtn.disabled = !hasSession || state.status === 'active' || state.status === 'finished';
    el.nextBtn.disabled = !hasSession || state.status !== 'active';
    el.finishBtn.disabled = !hasSession || state.status === 'finished';
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

  function renderModeCards() {
    var html = '';
    state.modes.forEach(function (mode) {
      var isActive = state.selectedMode === mode.id;
      html +=
        '<button type="button" class="mode-card' + (isActive ? ' active' : '') + '" data-mode-id="' + escapeAttr(mode.id) + '">' +
        '<span class="mode-icon">' + getModeSvg(mode.id) + '</span>' +
        '<span class="mode-title">' + shared.escapeHtml(mode.title) + '</span>' +
        '<span class="mode-subtitle">' + shared.escapeHtml(mode.subtitle || '') + '</span>' +
        '</button>';
    });
    el.modeCards.innerHTML = html;

    var buttons = el.modeCards.querySelectorAll('button.mode-card');
    buttons.forEach(function (button) {
      button.disabled = state.setupLocked;
      button.addEventListener('click', function () {
        if (state.setupLocked) {
          return;
        }
        setSelectedMode(button.getAttribute('data-mode-id'));
      });
    });

    updateModeHint();
  }

  function updateModeHint() {
    var mode = getModeById(state.selectedMode);
    if (!mode) {
      el.modeHint.textContent = '';
      return;
    }

    if (mode.hasMiniGame) {
      el.modeHint.textContent = mode.description + ' Unlock: від ' + mode.unlockScore + ' балів.';
    } else {
      el.modeHint.textContent = mode.description;
    }
  }

  function setSelectedMode(modeId) {
    if (!modeId) {
      return;
    }
    state.selectedMode = modeId;
    renderModeCards();
    renderSessionMeta();
  }

  function renderQuizSelect() {
    var selected = state.selectedQuizId;
    if (!selected && state.quizzes.length) {
      selected = state.quizzes[0].id;
    }
    var html = '';
    state.quizzes.forEach(function (quiz) {
      var label = quiz.name + ' (' + quiz.questionCount + ' пит.)';
      html += '<option value="' + escapeAttr(quiz.id) + '">' + shared.escapeHtml(label) + '</option>';
    });
    el.quizSelect.innerHTML = html;
    if (selected) {
      el.quizSelect.value = selected;
      state.selectedQuizId = selected;
    } else {
      state.selectedQuizId = null;
    }
    renderSessionMeta();
    setButtonsState();
  }

  async function loadGameModes() {
    try {
      var response = await shared.apiFetch('/api/host/game-modes');
      if (response && Array.isArray(response.items) && response.items.length) {
        state.modes = response.items;
      }
    } catch (error) {
      state.modes = FALLBACK_MODES.slice();
    }

    if (!getModeById(state.selectedMode)) {
      state.selectedMode = state.modes[0] ? state.modes[0].id : 'classic';
    }
    renderModeCards();
  }

  async function loadQuizLibrary(preferredQuizId) {
    el.quizLibraryStatus.textContent = 'Оновлення бібліотеки...';
    try {
      var response = await shared.apiFetch('/api/host/quizzes');
      state.quizzes = Array.isArray(response.items) ? response.items : [];

      if (preferredQuizId) {
        state.selectedQuizId = preferredQuizId;
      }
      renderQuizSelect();

      if (!state.quizzes.length) {
        el.quizLibraryStatus.textContent = 'Бібліотека порожня. Завантаж JSON квізу.';
      } else {
        el.quizLibraryStatus.textContent = 'Квізів у бібліотеці: ' + state.quizzes.length;
      }
    } catch (error) {
      el.quizLibraryStatus.textContent = 'Не вдалося завантажити бібліотеку: ' + error.message;
    }
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(new Error('Не вдалося прочитати файл.'));
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  function parseUploadedQuiz(content, filename) {
    var parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error('JSON має некоректний формат.');
    }

    var fallbackName = (filename || 'Новий квіз').replace(/\.[^.]+$/, '').trim() || 'Новий квіз';
    var payload = {
      name: fallbackName,
      description: '',
      mode: state.selectedMode,
      questions: null,
    };

    if (Array.isArray(parsed)) {
      payload.questions = parsed;
      return payload;
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('У файлі очікується масив питань або об’єкт з полем questions.');
    }

    if (typeof parsed.name === 'string' && parsed.name.trim()) {
      payload.name = parsed.name.trim();
    } else if (typeof parsed.title === 'string' && parsed.title.trim()) {
      payload.name = parsed.title.trim();
    }
    if (typeof parsed.description === 'string') {
      payload.description = parsed.description.trim();
    }
    if (typeof parsed.mode === 'string' && parsed.mode.trim()) {
      payload.mode = parsed.mode.trim().toLowerCase();
    }

    if (Array.isArray(parsed.questions)) {
      payload.questions = parsed.questions;
      return payload;
    }

    throw new Error('У файлі немає масиву questions.');
  }

  async function uploadQuizFromFile() {
    var file = el.quizFileInput.files && el.quizFileInput.files[0];
    if (!file) {
      el.quizLibraryStatus.textContent = 'Спочатку обери JSON-файл.';
      return;
    }

    el.quizLibraryStatus.textContent = 'Завантажую квіз...';
    try {
      var content = await readFileText(file);
      var payload = parseUploadedQuiz(content, file.name);
      var result = await shared.apiFetch('/api/host/quizzes', {
        method: 'POST',
        body: payload,
      });
      el.quizFileInput.value = '';
      el.quizLibraryStatus.textContent = 'Квіз збережено: ' + result.name + ' (' + result.questionCount + ' питань).';
      await loadQuizLibrary(result.quizId);
      if (result.mode) {
        setSelectedMode(result.mode);
      }
    } catch (error) {
      el.quizLibraryStatus.textContent = 'Помилка завантаження: ' + error.message;
    }
  }

  function setSetupLocked(locked) {
    state.setupLocked = locked;
    el.quizSelect.disabled = locked;
    el.refreshQuizzesBtn.disabled = locked;
    el.quizFileInput.disabled = locked;
    el.uploadQuizBtn.disabled = locked;

    var modeButtons = el.modeCards.querySelectorAll('button.mode-card');
    modeButtons.forEach(function (button) {
      button.disabled = locked;
    });

    setButtonsState();
  }

  function applyModeFromPayload(payload) {
    if (!payload) {
      return;
    }

    if (payload.modeMeta) {
      var next = [];
      var hasExisting = false;
      state.modes.forEach(function (mode) {
        if (mode.id === payload.modeMeta.id) {
          next.push(payload.modeMeta);
          hasExisting = true;
        } else {
          next.push(mode);
        }
      });
      if (!hasExisting) {
        next.push(payload.modeMeta);
      }
      state.modes = next;
    }

    if (payload.gameMode) {
      state.gameMode = payload.gameMode;
      state.selectedMode = payload.gameMode;
    }

    if (payload.quizId !== undefined && payload.quizId !== null) {
      state.sessionQuizId = payload.quizId;
    }

    renderModeCards();
    renderSessionMeta();
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
        applyModeFromPayload(data);
        setStatus(data.status || state.status);
        persistHostSession();
        el.sessionCode.textContent = state.sessionCode || '------';
        renderParticipants(data.participants || []);
        renderLeaderboard(data.leaderboard || []);
        setQuestionStatusFromState(data);
        if (state.status === 'finished') {
          showReportLinks();
        }
        setSetupLocked(Boolean(state.sessionId));
        setButtonsState();
        break;
      }
      case 'participant_joined': {
        if (data.participants) renderParticipants(data.participants);
        if (data.leaderboard) renderLeaderboard(data.leaderboard);
        break;
      }
      case 'session_state': {
        applyModeFromPayload(data);
        setStatus(data.status || state.status);
        setButtonsState();
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
        break;
      }
      case 'question_result': {
        if (data.leaderboard) renderLeaderboard(data.leaderboard);
        el.questionStatus.textContent =
          'Питання #' + (data.questionIndex + 1) +
          ' завершено. Правильна відповідь: варіант ' + (data.correctIndex + 1);
        break;
      }
      case 'leaderboard_update': {
        if (data.leaderboard) renderLeaderboard(data.leaderboard);
        break;
      }
      case 'session_finished': {
        applyModeFromPayload(data);
        if (data.leaderboard) renderLeaderboard(data.leaderboard);
        setStatus('finished');
        setButtonsState();
        el.questionStatus.textContent = 'Сесію завершено';
        showReportLinks();
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
    if (!state.selectedQuizId) {
      el.createStatus.textContent = 'Спочатку обери квіз у бібліотеці.';
      return;
    }

    el.createStatus.textContent = '';
    try {
      var payload = {
        title: DEFAULT_SESSION_TITLE,
        hostName: DEFAULT_HOST_NAME,
        quizId: state.selectedQuizId,
        gameMode: state.selectedMode,
      };

      var result = await shared.apiFetch('/api/host/sessions', {
        method: 'POST',
        body: payload,
      });

      state.sessionId = result.sessionId;
      state.sessionCode = result.sessionCode;
      state.hostToken = result.hostToken;
      state.totalQuestions = result.totalQuestions;
      state.sessionQuizId = result.quizId || state.selectedQuizId;
      applyModeFromPayload(result);
      setStatus(result.status);
      persistHostSession();
      el.sessionCode.textContent = state.sessionCode;
      el.createStatus.textContent = 'Лобі створено.';
      setSetupLocked(true);
      setButtonsState();
      connectWs();
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
    setButtonsState();

    try {
      var statePayload = await shared.apiFetch(
        '/api/host/sessions/' + state.sessionId + '/state',
        shared.withAuth(state.hostToken, { method: 'GET' })
      );
      state.totalQuestions = statePayload.totalQuestions || 0;
      applyModeFromPayload(statePayload);
      setStatus(statePayload.status || 'lobby');
      renderParticipants(statePayload.participants || []);
      renderLeaderboard(statePayload.leaderboard || []);
      setQuestionStatusFromState(statePayload);
      if (state.status === 'finished') {
        showReportLinks();
      }
      setSetupLocked(true);
      connectWs();
    } catch (error) {
      clearSavedSession();
      state.sessionId = null;
      state.hostToken = null;
      state.sessionCode = null;
      state.sessionQuizId = null;
      setStatus('lobby');
      setButtonsState();
      setSetupLocked(false);
      el.sessionCode.textContent = '------';
      el.createStatus.textContent = 'Збережену сесію не вдалося відновити: ' + error.message;
    }
  }

  el.createBtn.addEventListener('click', function () {
    createSession();
  });

  el.refreshQuizzesBtn.addEventListener('click', function () {
    loadQuizLibrary(state.selectedQuizId);
  });

  el.uploadQuizBtn.addEventListener('click', function () {
    uploadQuizFromFile();
  });

  el.quizSelect.addEventListener('change', function () {
    state.selectedQuizId = el.quizSelect.value || null;
    renderSessionMeta();
    setButtonsState();
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
    state.sessionQuizId = null;
    state.totalQuestions = 0;
    state.gameMode = state.selectedMode;
    setStatus('lobby');
    setButtonsState();
    setSetupLocked(false);
    el.sessionCode.textContent = '------';
    el.questionStatus.textContent = 'Очікування старту';
    el.reportLinks.innerHTML = '';
    renderParticipants([]);
    renderLeaderboard([]);
    renderSessionMeta();
    el.createStatus.textContent = 'Збережену host-сесію очищено.';
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

  el.questionStatus.textContent = 'Очікування старту';
  updateLeaderboardVisibility();
  renderModeCards();

  Promise.all([loadGameModes(), loadQuizLibrary(null)])
    .then(function () {
      renderSessionMeta();
      setButtonsState();
      restoreSavedSession();
    })
    .catch(function () {
      renderSessionMeta();
      setButtonsState();
      restoreSavedSession();
    });
})();
