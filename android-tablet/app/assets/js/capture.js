(function () {
  var C = window.ZJCore;
  var $ = function (selector) { return document.querySelector(selector); };
  var state = {
    text: '',
    paragraphs: [],
    segmenter: null,
    settings: C.getSettings(),
    selection: null,
    currentText: '',
    context: '',
    mode: 'annotate',
    question: '',
    lastQuestion: '',
    turns: [],
    id: null,
    streaming: false,
    answer: '',
    started: 0,
    rec: null,
    // 本轮回答有没有已经存过历史（见 panel.js 同名字段注释）。
    recorded: false
  };
  var renderPending = false;
  var toolbarShownAt = 0;
  var toolbarHideTimer = null;
  var selTimer = null;

  /** 复制统一出口（理由见 panel.js 的 copyText）。 */
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

  /** 面板关闭/页面卸载时补记还没存的轮次（见 panel.js 的 savePendingTurn）。 */
  function savePendingTurn() {
    if (state.recorded || !state.answer) return;
    var mode = state.question ? 'ask' : state.mode;
    state.rec = C.record(mode, state.currentText, state.question, state.answer, null,
      Date.now() - state.started, state.context.length, null, threadTurns());
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
    var data = {};
    try {
      data = JSON.parse(C.invoke('captureInit') || '{}');
    } catch (exception) {
      data = {};
    }
    state.text = String(data.text || '').replace(/\r\n/g, '\n').trim();
    state.settings = C.getSettings();
    var provider = C.getProvider(state.settings);
    var model = C.modelOf(state.settings);
    $('#model').textContent = provider.name + ' · ' + C.modelLabel(model, provider.id);
    var badge = $('#modelMult');
    if (badge) {
      var multiplier = C.usageMultiplier(model);
      badge.textContent = C.formatUsageMultiplier(multiplier);
      badge.className = 'mult-badge ' + C.multiplierTone(multiplier);
    }
    renderDoc(state.text);
    $('#sub').textContent = state.text ? '点词注解，或拖选一段' : '没有抓到页面文字';
    bind();
    document.addEventListener('selectionchange', debounce(onSelection, 60));
    document.addEventListener('pointerdown', function (event) {
      if (!document.getElementById('selToolbar').contains(event.target)) {
        hideToolbar();
      }
    }, true);
    $('#docWrap').addEventListener('scroll', hideToolbar);
    if (!state.text) {
      $('#empty').hidden = false;
      $('#empty').textContent = '没有抓到页面文字。';
      $('#send').disabled = true;
    } else if (!C.keyOf(state.settings)) {
      $('#empty').hidden = true;
      showError('还没填 API Key。打开「注解」设置里粘贴 Key，再回来。');
    }
  }

  function bind() {
        $('#close').addEventListener('click', function () {
      if (state.id) C.cancel(state.id);
      C.invoke('closePanel');
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
     * 实体键盘复制（理由见 panel.js 的同名监听）：有选区拷选区，
     * 没选区拷整段答案；Ctrl+A 全选答案。焦点在输入框里时不拦截。
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
    $('#doc').addEventListener('click', onDocClick);
    document.getElementById('selToolbar').addEventListener('pointerdown', function (event) {
      var button = event.target.closest('button[data-mode]');
      if (!button) return;
      event.preventDefault();
      var mode = button.getAttribute('data-mode');
      var selection = state.selection;
      hideToolbar();
      if (!selection) {
        C.invoke('toast', '先选中一段文字。');
        return;
      }
      begin(mode, selection);
    });
  }

  function renderDoc(text) {
    var doc = $('#doc');
    doc.innerHTML = '';
    state.paragraphs = [];
    var start = 0;
    text.split('\n').forEach(function (line) {
      var paragraph = document.createElement('p');
      paragraph.className = 'cap-para';
      paragraph.textContent = line.length ? line : '\u00a0';
      doc.appendChild(paragraph);
      state.paragraphs.push({ el: paragraph, start: start, text: line });
      start += line.length + 1;
    });
  }

  function onDocClick(event) {
    var selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    var paragraph = event.target.closest && event.target.closest('.cap-para');
    if (!paragraph) return;
    var offset = caretOffset(paragraph, event.clientX, event.clientY);
    if (offset < 0) return;
    var info = null;
    for (var index = 0; index < state.paragraphs.length; index++) {
      if (state.paragraphs[index].el === paragraph) {
        info = state.paragraphs[index];
        break;
      }
    }
    if (!info || !info.text) return;
    var word = wordAt(info.text, offset);
    if (!word || !word.text) return;
    var globalStart = info.start + word.start;
    var context = state.text.slice(
      Math.max(0, globalStart - 150),
      Math.min(state.text.length, globalStart + word.text.length + 150)
    );
    var rect = {
      left: event.clientX - 10,
      top: event.clientY - 14,
      bottom: event.clientY + 16,
      width: 20,
      height: 30
    };
    state.selection = { text: word.text, context: context, rect: rect };
    showToolbar(rect);
  }

  function caretOffset(paragraph, x, y) {
    var range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      var position = document.caretPositionFromPoint(x, y);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    }
    if (!range || !paragraph.contains(range.startContainer)) return -1;
    var before = document.createRange();
    before.selectNodeContents(paragraph);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString().length;
  }

  function wordAt(text, offset) {
    if (!text) return null;
    offset = Math.max(0, Math.min(offset, text.length - 1));
    var segments = null;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        if (!state.segmenter) {
          state.segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
        }
        segments = Array.from(state.segmenter.segment(text));
      } catch (exception) {
        segments = null;
      }
    }
    if (segments && segments.length) {
      var index = -1;
      for (var i = 0; i < segments.length; i++) {
        var item = segments[i];
        if (item.index <= offset && offset < item.index + item.segment.length) {
          index = i;
          break;
        }
        if (item.index > offset) {
          index = Math.max(0, i - 1);
          break;
        }
      }
      if (index < 0) index = segments.length - 1;
      var chosen = findWordSegment(segments, index);
      if (chosen) {
        var raw = chosen.segment;
        var lead = raw.length - raw.replace(/^\s+/, '').length;
        return { text: raw.trim(), start: chosen.index + lead };
      }
    }
    return sentenceAt(text, offset);
  }

  function findWordSegment(segments, index) {
    var wordPattern = /[0-9A-Za-z\u00C0-\u024F\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
    if (wordPattern.test(segments[index].segment)) return segments[index];
    for (var step = 1; step < segments.length; step++) {
      var left = segments[index - step];
      var right = segments[index + step];
      if (left && wordPattern.test(left.segment)) return left;
      if (right && wordPattern.test(right.segment)) return right;
      if (!left && !right) break;
    }
    return null;
  }

  function sentenceAt(text, offset) {
    var stops = '。！？!?；;\n';
    var start = Math.max(0, offset - 150);
    var end = Math.min(text.length, offset + 150);
    var left = offset;
    while (left > start && stops.indexOf(text.charAt(left - 1)) === -1) left--;
    var right = offset;
    while (right < end && stops.indexOf(text.charAt(right)) === -1) right++;
    var raw = text.slice(left, right);
    var value = raw.trim();
    if (!value) {
      left = start;
      raw = text.slice(start, end);
      value = raw.trim();
    }
    if (!value) return null;
    var lead = raw.length - raw.replace(/^\s+/, '').length;
    return { text: value, start: left + lead };
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  function onSelection() {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      if (Date.now() - toolbarShownAt > 1200) hideToolbarSoon();
      return;
    }
    var text = selection.toString().trim();
    if (!text) {
      hideToolbarSoon();
      return;
    }
    var truncated = text.length > 2000;
    if (truncated) text = text.slice(0, 2000);
    var anchor = selection.anchorNode;
    var node = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
    if (!node || !$('#doc').contains(node)) {
      hideToolbarSoon();
      return;
    }
    var index = state.text.indexOf(text);
    var start = index >= 0
      ? Math.max(0, index - 150)
      : Math.max(0, (selection.anchorOffset || 0) - 150);
    var context = state.text.slice(start, start + 300);
    var rect = null;
    try {
      rect = selection.getRangeAt(0).getBoundingClientRect();
    } catch (exception) {
      rect = null;
    }
    if (!rect || (!rect.width && !rect.height)) {
      rect = $('#doc').getBoundingClientRect();
    }
    state.selection = {
      text: text,
      truncated: truncated,
      context: context,
      rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
    };
    showToolbar(state.selection.rect);
  }

  function showToolbar(rect) {
    var toolbar = document.getElementById('selToolbar');
    var left = rect.left + rect.width / 2;
    left = Math.max(90, Math.min(left, window.innerWidth - 90));
    var top = rect.top - 46;
    if (top < 8) top = rect.bottom + 10;
    toolbar.style.left = left + 'px';
    toolbar.style.top = top + 'px';
    toolbar.classList.add('show');
    toolbarShownAt = Date.now();
    clearTimeout(toolbarHideTimer);
  }

  function hideToolbar() {
    clearTimeout(toolbarHideTimer);
    document.getElementById('selToolbar').classList.remove('show');
  }

  function hideToolbarSoon() {
    clearTimeout(toolbarHideTimer);
    toolbarHideTimer = setTimeout(hideToolbar, 700);
  }

  function begin(mode, selection) {
    document.querySelector('.cap').classList.add('has-answer');
    state.selection = selection;
    state.currentText = selection.text;
    state.context = selection.context;
    state.mode = mode;
    state.turns = [];
    state.answer = '';
    state.question = '';
    state.lastQuestion = '';
    state.rec = null;
    $('#quote').textContent = selection.text;
    $('#quote').hidden = false;
    $('#meta').innerHTML = '<span class="chip">选中 ' + selection.text.length + ' 字</span>'
      + (selection.truncated ? '<span class="chip">超长，已取前 2000 字</span>' : '')
      + '<span class="chip">抓取页上下文</span>';
    $('#empty').hidden = true;
    $('#answer').innerHTML = '';
    $('#error').hidden = true;
    $('#error').innerHTML = '';
    $('#status').textContent = '';
    $('#input').value = '';
    $('#input').placeholder = mode === 'ask' ? '就问这段文字…' : '继续追问…';
    if (mode === 'ask') {
      $('#sub').textContent = '输入问题后发送';
      setTimeout(function () { $('#input').focus(); }, 180);
    } else {
      $('#sub').textContent = '结合抓取页回答';
      run(null);
    }
  }

  function run(question) {
    if (state.streaming) return;
    if (!state.currentText) {
      C.invoke('toast', '先选中一段文字。');
      return;
    }
    state.settings = C.getSettings();
    if (!C.keyOf(state.settings)) {
      showError('还没填 API Key。打开「注解」设置里粘贴 Key，再回来。');
      return;
    }
    var mode = question ? 'ask' : state.mode;
    if (state.question || state.answer) {
      state.turns.push({ question: state.question, answer: state.answer });
      if (state.turns.length > 8) state.turns.shift();
    }
    state.question = question || '';
    state.lastQuestion = question || '';
    state.answer = '';
    state.started = Date.now();
    state.streaming = true;
    state.id = null;
    state.recorded = false;
    $('#answer').innerHTML = '';
    $('#error').hidden = true;
    $('#error').innerHTML = '';
    $('#status').textContent = '正在回答…';
    $('#send').disabled = false;
    $('#send').textContent = '停止';
    renderAnswer();

    var request = C.buildRequest(mode, state.currentText, state.context,
      state.question, state.turns, state.settings);
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
    var pane = $('#answerPane');
    var nearBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 120;
    var html = C.threadHtml(state.turns, state.question, state.answer, state.streaming);
    $('#answer').innerHTML = html;
    if (nearBottom) pane.scrollTop = pane.scrollHeight;
  }

  function finish(usage, error) {
    state.streaming = false;
    state.id = null;
    $('#send').disabled = false;
    $('#send').textContent = '发送';
    var elapsed = Date.now() - state.started;
    var mode = state.question ? 'ask' : state.mode;
    if (error) {
      if (!state.recorded) {
        state.rec = C.record(mode, state.currentText, state.question, state.answer,
          null, elapsed, state.context.length, error, threadTurns());
        state.recorded = true;
      }
      renderAnswer();
      showError(error);
      $('#status').textContent = '请求失败';
      return;
    }
    if (!state.recorded) {
      state.rec = C.record(mode, state.currentText, state.question, state.answer,
        usage, elapsed, state.context.length, null, threadTurns());
      state.recorded = true;
    }
    renderAnswer();
    $('#status').textContent = C.formatTokens(state.rec.totalTokens) + ' tokens · '
      + C.formatCost(state.rec.cost) + (usage && usage.estimated ? ' 估算' : '');
    $('#input').placeholder = '继续追问…';
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

  function send() {
    if (state.streaming) {
      C.invoke('toast', '等这次回答结束。');
      return;
    }
    if (!state.currentText) {
      C.invoke('toast', '先在左边选中文字。');
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

  init();
})();