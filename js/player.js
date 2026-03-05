(function () {
  var shared = window.quizShared;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MINI_GAME_DURATION_SEC = 20;
  var MINI_GAME_TARGET = 8;
  var MINI_GAME_SPAWN_MS = 900;

  var FALLBACK_MODE = {
    id: 'classic',
    title: 'Класичний квіз',
    subtitle: 'Швидкість + точність',
    description: 'Відповідай на питання і набирай бали.',
    unlockScore: 0,
    hasMiniGame: false,
  };

  var state = {
    sessionId: null,
    sessionCode: null,
    participantId: null,
    playerToken: null,
    ws: null,
    status: 'lobby',
    currentQuestion: null,
    answered: false,
    leaderboard: [],
    myScore: 0,
    myRank: null,
    gameMode: 'classic',
    modeMeta: null,
    miniUnlocked: false,
    miniRunning: false,
    miniHits: 0,
    miniTimeLeft: MINI_GAME_DURATION_SEC,
    miniTimerHandle: null,
    miniSpawnHandle: null,
    miniCleanupTimeouts: [],
  };

  var el = {
    joinSection: document.getElementById('joinSection'),
    codeInput: document.getElementById('codeInput'),
    nicknameInput: document.getElementById('nicknameInput'),
    joinBtn: document.getElementById('joinBtn'),
    joinStatus: document.getElementById('joinStatus'),
    gameSection: document.getElementById('gameSection'),
    sessionCode: document.getElementById('sessionCode'),
    sessionStatus: document.getElementById('sessionStatus'),
    myScore: document.getElementById('myScore'),
    myRank: document.getElementById('myRank'),
    questionBox: document.getElementById('questionBox'),
    gameInfo: document.getElementById('gameInfo'),
    leaderboardSection: document.getElementById('leaderboardSection'),
    leaderboardTable: document.querySelector('#leaderboardTable tbody'),
    modeSection: document.getElementById('modeSection'),
    modeTitle: document.getElementById('modeTitle'),
    modeSubtitle: document.getElementById('modeSubtitle'),
    unlockProgress: document.getElementById('unlockProgress'),
    unlockFill: document.getElementById('unlockFill'),
    unlockText: document.getElementById('unlockText'),
    archGamePanel: document.getElementById('archGamePanel'),
    startMiniGameBtn: document.getElementById('startMiniGameBtn'),
    miniTimer: document.getElementById('miniTimer'),
    miniHits: document.getElementById('miniHits'),
    miniGameStatus: document.getElementById('miniGameStatus'),
    archGameSvg: document.getElementById('archGameSvg'),
    artifactLayer: document.getElementById('artifactLayer'),
  };

  function getModeMeta() {
    return state.modeMeta || FALLBACK_MODE;
  }

  function applyJoinPrefillFromQuery() {
    var params = new URLSearchParams(window.location.search);
    var code = (params.get('code') || '').trim();
    var nickname = (params.get('nickname') || '').trim();
    if (code) {
      el.codeInput.value = code.toUpperCase();
    }
    if (nickname) {
      el.nicknameInput.value = nickname;
    }
  }

  function setStatus(status) {
    state.status = status;
    el.sessionStatus.textContent = status;
  }

  function applyModeData(payload) {
    if (!payload) {
      return;
    }

    if (payload.gameMode) {
      state.gameMode = payload.gameMode;
    }
    if (payload.modeMeta) {
      state.modeMeta = payload.modeMeta;
    }

    if (!state.modeMeta && state.gameMode !== 'classic') {
      state.modeMeta = {
        id: state.gameMode,
        title: 'Ігровий режим',
        subtitle: 'Режим із mini-game',
        description: 'Відповідай на питання, щоб відкрити ігрову сесію.',
        unlockScore: 1200,
        hasMiniGame: true,
      };
    }

    renderModeSection();
  }

  function renderLeaderboard(items) {
    state.leaderboard = items || [];
    el.leaderboardSection.style.display = 'block';
    el.leaderboardTable.innerHTML = '';
    state.myScore = 0;
    state.myRank = null;

    if (!state.leaderboard.length) {
      el.leaderboardTable.innerHTML = '<tr><td colspan="3" class="small">Немає даних</td></tr>';
      el.myScore.textContent = '0';
      el.myRank.textContent = '-';
      updateModeUnlockState();
      return;
    }

    state.leaderboard.forEach(function (item) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + item.rank + '</td>' +
        '<td>' + shared.escapeHtml(item.nickname) + '</td>' +
        '<td>' + item.score + '</td>';
      if (item.participantId === state.participantId) {
        state.myScore = item.score;
        state.myRank = item.rank;
      }
      el.leaderboardTable.appendChild(tr);
    });

    el.myScore.textContent = String(state.myScore);
    el.myRank.textContent = state.myRank ? String(state.myRank) : '-';
    updateModeUnlockState();
  }

  function renderLobby() {
    el.questionBox.innerHTML = '<p class="small">Очікуємо старт від викладача…</p>';
    el.gameInfo.textContent = '';
  }

  function renderQuestion(question) {
    state.currentQuestion = question;
    state.answered = false;
    var html = '';
    html += '<h3>Питання ' + (question.questionIndex + 1) + '/' + question.totalQuestions + '</h3>';
    html += '<p>' + shared.escapeHtml(question.prompt) + '</p>';
    html += '<div class="options" id="options"></div>';
    el.questionBox.innerHTML = html;

    var container = document.getElementById('options');
    question.options.forEach(function (optionText, idx) {
      var btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = (idx + 1) + '. ' + optionText;
      btn.addEventListener('click', function () {
        submitAnswer(idx, btn);
      });
      container.appendChild(btn);
    });

    el.gameInfo.textContent = 'Ліміт часу: ' + question.timeLimitSec + 'с';
  }

  function markAnswerButtons(correctIndex) {
    var buttons = el.questionBox.querySelectorAll('button.option-btn');
    buttons.forEach(function (btn, idx) {
      btn.disabled = true;
      if (idx === correctIndex) {
        btn.classList.add('correct');
      }
    });
  }

  async function submitAnswer(answerIndex, clickedBtn) {
    if (!state.playerToken || !state.sessionId || !state.currentQuestion || state.answered) {
      return;
    }
    state.answered = true;

    var buttons = el.questionBox.querySelectorAll('button.option-btn');
    buttons.forEach(function (btn) {
      btn.disabled = true;
    });
    clickedBtn.classList.add('wrong');

    try {
      var result = await shared.apiFetch(
        '/api/player/sessions/' + state.sessionId + '/answer',
        shared.withAuth(state.playerToken, {
          method: 'POST',
          body: {
            answerIndex: answerIndex,
            questionIndex: state.currentQuestion.questionIndex,
          },
        })
      );

      if (result.isCorrect) {
        clickedBtn.classList.remove('wrong');
        clickedBtn.classList.add('correct');
      }
      el.gameInfo.textContent =
        (result.isCorrect ? 'Правильно' : 'Відповідь зафіксовано') +
        '. +' + result.pointsAwarded + ' балів';
    } catch (error) {
      el.gameInfo.textContent = 'Помилка відправки: ' + error.message;
      state.answered = false;
      buttons.forEach(function (btn) {
        btn.disabled = false;
      });
    }
  }

  function connectWs() {
    if (!state.playerToken) return;
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }
    state.ws = shared.createWs(state.playerToken);

    state.ws.onopen = function () {
      el.gameInfo.textContent = 'Підключено до сесії.';
    };
    state.ws.onclose = function () {
      el.gameInfo.textContent = 'Зв’язок втрачено. Онови сторінку.';
      stopMiniGame(false);
    };
    state.ws.onmessage = function (event) {
      var msg = JSON.parse(event.data);
      handleEvent(msg.event, msg.data || {});
    };
  }

  function clearMiniTimers() {
    if (state.miniTimerHandle) {
      clearInterval(state.miniTimerHandle);
      state.miniTimerHandle = null;
    }
    if (state.miniSpawnHandle) {
      clearInterval(state.miniSpawnHandle);
      state.miniSpawnHandle = null;
    }
    while (state.miniCleanupTimeouts.length) {
      clearTimeout(state.miniCleanupTimeouts.pop());
    }
  }

  function setMiniStatus(text) {
    el.miniGameStatus.textContent = text;
  }

  function updateMiniHud() {
    el.miniTimer.textContent = state.miniTimeLeft + 'с';
    el.miniHits.textContent = state.miniHits + ' / ' + MINI_GAME_TARGET;
  }

  function clearArtifacts() {
    el.artifactLayer.innerHTML = '';
  }

  function createSvgNode(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function spawnArtifact() {
    if (!state.miniRunning) {
      return;
    }

    var x = 72 + Math.random() * 276;
    var y = 132 + Math.random() * 84;
    var group = createSvgNode('g', {
      class: 'artifact-token',
      transform: 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')',
    });

    var core = createSvgNode('circle', {
      cx: '0',
      cy: '0',
      r: '13',
      fill: 'rgba(249, 214, 148, 0.94)',
      stroke: 'rgba(255, 242, 204, 0.88)',
      'stroke-width': '2',
    });
    var rune = createSvgNode('path', {
      d: 'M -5 -1 L 0 -9 L 5 -1 L 0 8 Z',
      fill: 'rgba(132, 76, 201, 0.9)',
    });
    var sparkle = createSvgNode('circle', {
      cx: '-3',
      cy: '-4',
      r: '2',
      fill: '#fff6dd',
    });

    group.appendChild(core);
    group.appendChild(rune);
    group.appendChild(sparkle);

    group.addEventListener('click', function () {
      if (!state.miniRunning) {
        return;
      }
      state.miniHits += 1;
      updateMiniHud();
      group.remove();
      if (state.miniHits >= MINI_GAME_TARGET) {
        stopMiniGame(true);
      }
    });

    el.artifactLayer.appendChild(group);

    var ttl = setTimeout(function () {
      if (group.parentNode) {
        group.remove();
      }
    }, 2600);
    state.miniCleanupTimeouts.push(ttl);
  }

  function stopMiniGame(success) {
    if (!state.miniRunning) {
      return;
    }

    state.miniRunning = false;
    clearMiniTimers();
    el.startMiniGameBtn.disabled = false;

    if (success) {
      setMiniStatus('Експедиція успішна! Артефакти зібрано: ' + state.miniHits + '.');
      return;
    }

    setMiniStatus('Спробу завершено. Зібрано ' + state.miniHits + ' артефактів.');
  }

  function startMiniGame() {
    if (!state.miniUnlocked || getModeMeta().id !== 'archaeology') {
      return;
    }

    clearMiniTimers();
    clearArtifacts();

    state.miniRunning = true;
    state.miniHits = 0;
    state.miniTimeLeft = MINI_GAME_DURATION_SEC;
    updateMiniHud();

    el.startMiniGameBtn.disabled = true;
    setMiniStatus('Розкопки тривають. Клікай на артефакти!');

    state.miniSpawnHandle = setInterval(spawnArtifact, MINI_GAME_SPAWN_MS);
    spawnArtifact();

    state.miniTimerHandle = setInterval(function () {
      state.miniTimeLeft -= 1;
      updateMiniHud();
      if (state.miniTimeLeft <= 0) {
        stopMiniGame(false);
      }
    }, 1000);
  }

  function renderModeSection() {
    var mode = getModeMeta();
    if (!mode || mode.id === 'classic') {
      el.modeSection.style.display = 'none';
      clearMiniTimers();
      state.miniRunning = false;
      state.miniUnlocked = false;
      return;
    }

    el.modeSection.style.display = 'block';
    el.modeTitle.textContent = mode.title || 'Ігровий режим';
    el.modeSubtitle.textContent = mode.description || mode.subtitle || '';

    if (mode.hasMiniGame) {
      el.unlockProgress.style.display = 'block';
      updateModeUnlockState();
    } else {
      el.unlockProgress.style.display = 'none';
      el.archGamePanel.style.display = 'none';
      state.miniUnlocked = false;
    }
  }

  function updateModeUnlockState() {
    var mode = getModeMeta();
    if (!mode || !mode.hasMiniGame) {
      el.archGamePanel.style.display = 'none';
      state.miniUnlocked = false;
      return;
    }

    var unlockScore = Number(mode.unlockScore || 0);
    var current = Number(state.myScore || 0);
    var ratio = unlockScore > 0 ? Math.min(100, Math.round((current / unlockScore) * 100)) : 100;

    el.unlockFill.style.width = ratio + '%';
    var track = el.unlockProgress.querySelector('.unlock-track');
    if (track) {
      track.setAttribute('aria-valuenow', String(ratio));
    }

    if (current >= unlockScore) {
      state.miniUnlocked = true;
      el.unlockText.textContent = 'Доступ відкрито! Запускай "Команду археологів".';
      el.archGamePanel.style.display = 'block';
      if (!state.miniRunning) {
        el.startMiniGameBtn.disabled = false;
      }
      return;
    }

    state.miniUnlocked = false;
    if (state.miniRunning) {
      stopMiniGame(false);
    }
    el.archGamePanel.style.display = 'none';
    var left = Math.max(0, unlockScore - current);
    el.unlockText.textContent = 'Ще ' + left + ' балів до доступу до експедиції.';
  }

  function handleEvent(event, data) {
    switch (event) {
      case 'sync_state':
        setStatus(data.status || state.status);
        state.sessionId = data.sessionId || state.sessionId;
        state.sessionCode = data.sessionCode || state.sessionCode;
        el.sessionCode.textContent = state.sessionCode || '------';
        applyModeData(data);
        renderLeaderboard(data.leaderboard || []);
        if (data.currentQuestion && data.status === 'active') {
          renderQuestion(data.currentQuestion);
        } else if (data.status === 'lobby') {
          renderLobby();
        }
        break;

      case 'session_state':
        applyModeData(data);
        setStatus(data.status || state.status);
        if (state.status === 'lobby') {
          renderLobby();
        }
        break;

      case 'question_open':
        setStatus('active');
        renderQuestion(data);
        break;

      case 'answer_ack':
        el.gameInfo.textContent = (data.isCorrect ? 'Правильно' : 'Відповідь прийнято') +
          '. +' + data.pointsAwarded + ' балів';
        break;

      case 'question_result':
        markAnswerButtons(data.correctIndex);
        if (data.leaderboard) {
          renderLeaderboard(data.leaderboard);
        }
        el.gameInfo.textContent = 'Питання завершено. Правильна відповідь: #' + (data.correctIndex + 1);
        break;

      case 'leaderboard_update':
        if (data.leaderboard) {
          renderLeaderboard(data.leaderboard);
        }
        break;

      case 'session_finished':
        applyModeData(data);
        setStatus('finished');
        if (data.leaderboard) {
          renderLeaderboard(data.leaderboard);
        }
        el.gameInfo.textContent = 'Сесію завершено. Дякую за участь.';
        break;

      case 'participant_joined':
      case 'pong':
        break;

      default:
        el.gameInfo.textContent = 'Подія: ' + event;
    }
  }

  async function joinSession() {
    el.joinStatus.textContent = '';
    try {
      var result = await shared.apiFetch('/api/player/join', {
        method: 'POST',
        body: {
          code: el.codeInput.value.trim().toUpperCase(),
          nickname: el.nicknameInput.value.trim(),
        },
      });

      state.sessionId = result.sessionId;
      state.sessionCode = result.sessionCode;
      state.participantId = result.participantId;
      state.playerToken = result.playerToken;
      applyModeData(result);

      el.joinSection.style.display = 'none';
      el.gameSection.style.display = 'block';
      el.sessionCode.textContent = state.sessionCode;
      setStatus(result.status);
      renderLobby();
      connectWs();
    } catch (error) {
      var apiInfo = shared.getApiBase();
      el.joinStatus.textContent =
        'Помилка: ' + error.message +
        '. API=' + apiInfo +
        '. Якщо це "Failed to fetch", відкрий "Налаштування" і перевір API/WS URL.';
    }
  }

  el.joinBtn.addEventListener('click', function () {
    joinSession();
  });

  el.startMiniGameBtn.addEventListener('click', function () {
    startMiniGame();
  });

  updateMiniHud();
  setMiniStatus('');
  applyJoinPrefillFromQuery();
})();
