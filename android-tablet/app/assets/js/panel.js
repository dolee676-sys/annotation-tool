(function () {
  var C = window.ZJCore;
  var $ = function (selector) { return document.querySelector(selector); };
  var state = {
    mode: 'annotate',
    text: '',
    turns: [],
    id: null,
    streaming: false,
    answer: '',
    question: '',
    lastQuestion: '',
    started: 0,
    rec: null,
    favorited: false,
    pinned: false,
    settings: C.getSettings()
  };
  var renderPending = false;

  function init() {
    var initData = {};
    try {
      initData = JSON.parse(C.invoke('panelInit') || '{}');
    } catch (exception) {
      initData = {};
    }
    state.mode = initData.mode === 'ask' ? 'ask' : 'annotate';
    state.text = String(initData.text || '').trim();
    state.settings = C.getSettings();

    $('#icon').textContent = state.mode === 'ask' ? '问' : '注';
    $('#title').textContent = state.mode === 'ask' ? '提问' : '注解';
    $('#sub').textContent = '仅选中文字';
    var provider = C.getProvider(state.settings);
    var model = C.modelOf(state.settings);
    $('#model').textContent = provider.name + ' · ' + C.modelLabel(model, provider.id);
    updateMultiplier(model);
    setFavoriteActive(false);

    if (!state.text) {
      $('#quote').textContent = '';
      $('#meta').innerHTML = '';
      $('#empty').hidden = true;
      showError('没有读到选中文字。');
      $('#send').disabled = true;
      return;
    }

    $('#quote').textContent = state.text;
    $('#meta').innerHTML = '<span class="chip">选中 ' + state.text.length + ' 字</span>'
      + '<span class="chip">来自其他应用</span>';

    if (!C.keyOf(state.settings)) {
      showSetup();
      return;
    }

    if (state.mode === 'ask') {
      $('#empty').hidden = false;
      $('#empty').textContent = '选中文字已带上，直接问你想知道的。';
      $('#input').placeholder = '就问这段文字…';
      setTimeout(function () { $('#input').focus(); }, 220);
    } else {
      $('#empty').hidden = true;
      run(null);
    }
  }

  function run(question) {
    if (state.streaming) return;
    if (!state.text) return;
    state.settings = C.getSettings();
    if (!C.keyOf(state.settings)) {
      showSetup();
      return;
    }
    state.mode = state.mode || 'annotate';
    if (state.question || state.answer) {
      state.turns.push({ question: state.question, answer: state.answer });
      if (state.turns.length > 8) state.turns.shift();
    }
    state.question = question || '';
    state.lastQuestion = question || '';
    state.answer = '';
    state.started = Date.now();
    state.streaming = true;
    state.rec = null;
    $('#answer').innerHTML = '';
    $('#empty').hidden = true;
    $('#error').hidden = true;
    $('#error').innerHTML = '';
    $('#setup').hidden = true;
    $('#usage').textContent = '正在回答…';
    $('#send').disabled = false;
    $('#send').textContent = '停止';
    $('#copy').disabled = true;
    $('#favorite').disabled = true;
    state.favorited = false;
    setFavoriteActive(false);
    renderAnswer();

    var mode = question ? 'ask' : 'annotate';
    var request = C.buildRequest(mode, state.text, '', state.question, state.turns, state.settings);
    state.id = C.chat(request, {
      onDelta: function (piece) {
        state.answer += piece;
        scheduleRender();
      },
      onDone: function (usage) {
        finish(usage, null);
      },
      onError: function (message) {
        finish(null, message);
      }
    });
  }

  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(function () {
      renderPending = false;
      renderAnswer();
    });
  }

  function renderAnswer() {
    var scroll = $('#scroll');
    var nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120;
    var html = C.threadHtml(state.turns, state.question, state.answer, state.streaming);
    $('#answer').innerHTML = html;
    if (nearBottom) scroll.scrollTop = scroll.scrollHeight;
  }

  function finish(usage, error) {
    state.streaming = false;
    state.id = null;
    $('#send').disabled = false;
    $('#send').textContent = '发送';
    $('#input').disabled = false;
    $('#copy').disabled = false;
    $('#favorite').disabled = !state.answer || !!error;
    if (error) {
      state.favorited = false;
      setFavoriteActive(false);
    }
    var elapsed = Date.now() - state.started;

    if (error) {
      var failed = C.record(state.mode === 'ask' || state.question ? 'ask' : 'annotate',
        state.text, state.question, state.answer, null, elapsed, 0, error);
      state.rec = failed;
      renderAnswer();
      showError(error);
      $('#usage').textContent = '请求失败';
      return;
    }

    var record = C.record(state.mode === 'ask' || state.question ? 'ask' : 'annotate',
      state.text, state.question, state.answer, usage, elapsed, 0, null);
    state.rec = record;
    renderAnswer();
    $('#usage').textContent = C.formatTokens(record.totalTokens) + ' tokens · '
      + C.formatCost(record.cost) + (usage && usage.estimated ? ' 估算' : '');
    $('#input').placeholder = '继续追问…';
  }

  function showSetup() {
    $('#setup').hidden = false;
    $('#empty').hidden = true;
    $('#error').hidden = true;
    $('#answer').innerHTML = '';
    $('#send').disabled = true;
    $('#send').textContent = '发送';
    $('#input').disabled = true;
    $('#copy').disabled = true;
    $('#favorite').disabled = true;
    setFavoriteActive(false);
    $('#usage').textContent = '未配置';
  }

  function showError(message) {
    $('#error').innerHTML = C.escapeHtml(message)
      + '<br><button class="btn small" id="errRetry">重试</button>'
      + '<button class="btn small" id="errSettings">打开设置</button>';
    $('#error').hidden = false;
    var retry = $('#errRetry');
    if (retry) retry.addEventListener('click', function () {
      run(state.lastQuestion || null);
    });
    var button = $('#errSettings');
    if (button) button.addEventListener('click', function () {
      C.invoke('openMain');
    });
  }

  function bind() {
    $('#close').addEventListener('click', function () {
      if (state.id) C.cancel(state.id);
      C.invoke('closePanel');
    });
    $('#goSettings').addEventListener('click', function () {
      C.invoke('openMain');
    });
    $('#send').addEventListener('click', function () {
      if (state.streaming) {
        C.cancel(state.id);
      } else {
        send();
      }
    });
    $('#input').addEventListener('keydown', function (event) {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        send();
      }
    });
    $('#copy').addEventListener('click', function () {
      if (!state.answer) {
        C.invoke('toast', '还没有答案。');
        return;
      }
      C.invoke('copy', state.answer);
      C.invoke('toast', '已复制。');
    });
    $('#favorite').addEventListener('click', function () {
      if (!state.rec || !state.answer) {
        C.invoke('toast', '还没有可收藏的回答。');
        return;
      }
      if (state.favorited) {
        C.removeFavorite(state.rec.id);
        state.favorited = false;
        setFavoriteActive(false);
        C.invoke('toast', '已取消收藏。');
        return;
      }
      C.addFavorite(state.rec);
      state.favorited = true;
      setFavoriteActive(true);
      C.invoke('toast', '已收藏。');
    });
    $('#pin').addEventListener('click', function () {
      state.pinned = !state.pinned;
      C.invoke('setPinned', state.pinned);
      var button = $('#pin');
      button.classList.toggle('active', state.pinned);
      button.setAttribute('aria-pressed', state.pinned ? 'true' : 'false');
      button.title = state.pinned ? '已钉住：点外部不关闭（点此取消钉住）' : '钉在当前屏幕上';
    });
  }

  function updateMultiplier(model) {
    var badge = $('#modelMult');
    if (!badge) return;
    var value = C.usageMultiplier(model);
    badge.textContent = C.formatUsageMultiplier(value);
    badge.className = 'mult-badge ' + C.multiplierTone(value);
  }

  function setFavoriteActive(active) {
    var button = $('#favorite');
    if (!button) return;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.title = active ? '取消收藏' : '收藏当前问答';
  }

  function send() {
    if (state.streaming) {
      C.invoke('toast', '等这次回答结束。');
      return;
    }
    var question = $('#input').value.trim();
    if (!question) {
      C.invoke('toast', '先写下你的问题。');
      return;
    }
    $('#input').value = '';
    run(question);
  }

  bind();
  init();

  window.addEventListener('pagehide', function () {
    if (state.id) C.cancel(state.id);
  });
})();
