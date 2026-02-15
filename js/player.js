(function () {
  var shared = window.quizShared;

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
  };

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

  function renderLeaderboard(items) {
    state.leaderboard = items || [];
    el.leaderboardSection.style.display = 'block';
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
      if (item.participantId === state.participantId) {
        state.myScore = item.score;
        state.myRank = item.rank;
      }
      el.leaderboardTable.appendChild(tr);
    });

    el.myScore.textContent = String(state.myScore);
    el.myRank.textContent = state.myRank ? String(state.myRank) : '-';
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
    };
    state.ws.onmessage = function (event) {
      var msg = JSON.parse(event.data);
      handleEvent(msg.event, msg.data || {});
    };
  }

  function handleEvent(event, data) {
    switch (event) {
      case 'sync_state':
        setStatus(data.status || state.status);
        state.sessionId = data.sessionId || state.sessionId;
        state.sessionCode = data.sessionCode || state.sessionCode;
        el.sessionCode.textContent = state.sessionCode || '------';
        renderLeaderboard(data.leaderboard || []);
        if (data.currentQuestion && data.status === 'active') {
          renderQuestion(data.currentQuestion);
        } else if (data.status === 'lobby') {
          renderLobby();
        }
        break;

      case 'session_state':
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
        '. Якщо це \"Failed to fetch\", відкрий \"Налаштування\" і перевір API/WS URL.';
    }
  }

  el.joinBtn.addEventListener('click', function () {
    joinSession();
  });

  applyJoinPrefillFromQuery();
})();
