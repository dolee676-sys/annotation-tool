(function () {
  var C = window.ZJCore;
  var $ = function (selector) { return document.querySelector(selector); };
  var state = {
    mode: 'annotate',
    text: '',
    context: '',
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
    // 本次面板会话对应的历史记录 id：首次 create，追问按 id 原地更新，
    // 让一条注解里能看到我追问过的所有问题。
    historyId: null,
    // 本轮回答有没有已经存过历史。finish() 存完置 true；pagehide 补记
    // 时靠它保证只存一次（见 savePendingTurn）。
    recorded: false,
    settings: C.getSettings()
  };
  var renderPending = false;
  var selTimer = null;

  /**
   * 复制统一出口：先走原生 bridge（同步返回 "true"/"false"，见
   * OverlayBridge.copy），失败或浏览器预览时再试 navigator.clipboard，
   * 两路都失败才报失败——原来不管成败都 toast“已复制。”。
   */
  function copyText(text) {
    if (!text) {
      C.invoke('toast', '没有可复制的内容。');
      return;
    }
    var result = null;
    try {
      result = C.invoke('copy', text);
    } catch (exception) {
      result = null;
    }
    if (result === 'true' || result === true) {
      C.invoke('toast', '已复制。');
      return;
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard
        && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          C.invoke('toast', '已复制。');
        }, function () {
          C.invoke('toast', '复制失败，请长按选择复制。');
        });
        return;
      }
    } catch (exception) {
    }
    C.invoke('toast', '复制失败，请长按选择复制。');
  }

  /** 取 #answer / #quote 里的当前选区文本；没选区或选区不在答案区返回 ''。 */
  function selectedTextInAnswer() {
    try {
      var selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
      var node = selection.anchorNode;
      while (node) {
        if (node === $('#answer') || node === $('#quote')) return selection.toString();
        node = node.parentNode;
      }
      return '';
    } catch (exception) {
      return '';
    }
  }

  /** 本轮为止的完整问答串：之前的 turns + 当前这一问一答。 */
  function threadTurns() {
    var thread = state.turns.slice();
    if (state.question || state.answer) {
      thread.push({ question: state.question, answer: state.answer });
    }
    return thread;
  }

  /**
   * 面板关闭/页面卸载时补记还没存的轮次：流式没跑完就关面板时 finish()
   * 走不到（或回调落进重载后的新页面被丢掉），这一问就丢了。用
   * state.recorded 保证 finish() 存过的不会重复记。
   */
  function savePendingTurn() {
    if (state.recorded || !state.answer) return;
    var mode = state.mode === 'ask' || state.question ? 'ask' : 'annotate';
    state.rec = C.record(mode, state.text, state.question, state.answer, null,
      Date.now() - state.started, 0, null, threadTurns(), state.historyId);
    state.historyId = state.rec.id;
    state.recorded = true;
  }

  /** 选区变化后 120ms 再看：有选区就亮「复制所选」气泡并告诉原生不要关面板。 */
  function onSelectionChange() {
    if (selTimer) clearTimeout(selTimer);
    selTimer = setTimeout(updateSelCopy, 120);
  }

  function updateSelCopy() {
    var chip = $('#selCopy');
    if (!chip) return;
    var text = selectedTextInAnswer();
    var selection = null;
    try {
      selection = window.getSelection();
    } catch (exception) {
      selection = null;
    }
    if (!text || !selection || selection.rangeCount === 0) {
      chip.hidden = true;
      try {
        C.invoke('setSelectionActive', false);
      } catch (exception) {
      }
      return;
    }
    try {
      C.invoke('setSelectionActive', true);
    } catch (exception) {
    }
    var rect = null;
    try {
      rect = selection.getRangeAt(0).getBoundingClientRect();
    } catch (exception) {
      rect = null;
    }
    if (rect) {
      var vw = window.innerWidth || 400;
      var vh = window.innerHeight || 600;
      var x = Math.max(8, Math.min(rect.left, vw - 96));
      var y = Math.min(vh - 56, rect.bottom + 8);
      chip.style.left = Math.round(x) + 'px';
      chip.style.top = Math.round(y) + 'px';
    }
    chip.hidden = false;
  }

  function init() {
    var initData = {};
    try {
      initData = JSON.parse(C.invoke('panelInit') || '{}');
    } catch (exception) {
      initData = {};
    }
    state.mode = initData.mode === 'ask' ? 'ask' : 'annotate';
    state.text = String(initData.text || '').trim();
    state.context = String(initData.context || '').trim();
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
      + (state.context ? '<span class="chip">上下文 ' + state.context.length + ' 字</span>'
        : '<span class="chip">来自其他应用</span>');

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
    state.recorded = false;
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
    var request = C.buildRequest(mode, state.text, state.context, state.question, state.turns, state.settings);
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
      if (!state.recorded) {
        state.rec = C.record(state.mode === 'ask' || state.question ? 'ask' : 'annotate',
          state.text, state.question, state.answer, null, elapsed, 0, error, threadTurns(), state.historyId);
        state.historyId = state.rec.id;
        state.recorded = true;
      }
      renderAnswer();
      showError(error);
      $('#usage').textContent = '请求失败';
      return;
    }

    if (!state.recorded) {
      state.rec = C.record(state.mode === 'ask' || state.question ? 'ask' : 'annotate',
        state.text, state.question, state.answer, usage, elapsed, 0, null, threadTurns(), state.historyId);
      state.historyId = state.rec.id;
      state.recorded = true;
    }
    renderAnswer();
    $('#usage').textContent = C.formatTokens(state.rec.totalTokens) + ' tokens · '
      + C.formatCost(state.rec.cost) + (usage && usage.estimated ? ' 估算' : '');
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
      copyText(state.answer);
    });
    $('#selCopy').addEventListener('click', function () {
      var text = selectedTextInAnswer();
      if (text) copyText(text);
      try {
        window.getSelection().removeAllRanges();
      } catch (exception) {
      }
      $('#selCopy').hidden = true;
      try {
        C.invoke('setSelectionActive', false);
      } catch (exception) {
      }
    });
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('pagehide', savePendingTurn);
    /**
     * 实体键盘复制：悬浮窗里的 WebView 原生 Ctrl+C 依赖窗口焦点和系统
     * 选词 ActionMode，在 TYPE_ACCESSIBILITY_OVERLAY 窗口里并不可靠
     * （面板常拿不到焦点，选词条也可能弹不出）。这里直接在 JS 里接管：
     * 有选区拷选区，没选区拷整段答案；Ctrl+A 全选答案。
     * 焦点在输入框里时不拦截，让输入框自己的复制/全选正常走。
     * Shift+方向键不需要 JS，WebView 有焦点后原生就支持（焦点由
     * OverlayPanel.show() 里的 requestFocus() 保证，答案区加了
     * tabindex="0" 才能落键盘焦点）。
     */
    document.addEventListener('keydown', function (event) {
      var target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
        || target.isContentEditable)) return;
      if (event.isComposing || event.keyCode === 229) return;
      if (!event.ctrlKey && !event.metaKey) return;
      var key = (event.key || '').toLowerCase();
      if (key === 'c' || event.keyCode === 67) {
        var selected = selectedTextInAnswer();
        if (selected) {
          event.preventDefault();
          copyText(selected);
          return;
        }
        if (state.answer) {
          event.preventDefault();
          copyText(state.answer);
        }
        return;
      }
      if (key === 'a' || event.keyCode === 65) {
        var answerEl = $('#answer');
        if (answerEl && state.answer) {
          event.preventDefault();
          try {
            var selection = window.getSelection();
            selection.removeAllRanges();
            var range = document.createRange();
            range.selectNodeContents(answerEl);
            selection.addRange(range);
          } catch (exception) {
          }
        }
      }
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
