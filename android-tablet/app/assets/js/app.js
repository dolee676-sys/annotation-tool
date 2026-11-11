(function () {
  var C = window.ZJCore;
  var $ = function (selector) { return document.querySelector(selector); };
  var OFFICIAL_UPDATE_URL = 'https://api.github.com/repos/dolee676-sys/annotation-tool/contents/android-release/latest.json';
  var state = {
    tab: 'home',
    recTab: 'history',
    reader: { text: '', title: '', blocks: [] },
    selection: null,
    currentList: [],
    settings: C.getSettings(),
    update: window.ZJUpdate.state,
    pane: {
      mode: null,
      lastMode: 'annotate',
      text: '',
      context: '',
      turns: [],
      id: null,
      streaming: false,
      answer: '',
      question: '',
      started: 0,
      rec: null
    }
  };

  var els = {};
  var renderPending = false;
  var toastTimer = null;
  function init() {
    els.tabs = $('#tabs');
    els.readHome = $('#readHome');
    els.reader = $('#reader');
    els.pasteText = $('#pasteText');
    els.doc = $('#doc');
    els.docWrap = $('#docWrap');
    els.docTitle = $('#docTitle');
    els.readerMeta = $('#readerMeta');
    els.selToolbar = $('#selToolbar');
    els.answerPane = $('#answerPane');
    els.paneScrim = $('#paneScrim');
    els.paneIcon = $('#paneIcon');
    els.paneTitle = $('#paneTitle');
    els.paneSub = $('#paneSub');
    els.paneModel = $('#paneModel');
    els.paneQuote = $('#paneQuote');
    els.paneMeta = $('#paneMeta');
    els.paneAnswer = $('#paneAnswer');
    els.paneEmpty = $('#paneEmpty');
    els.paneError = $('#paneError');
    els.paneInput = $('#paneInput');
    els.paneSend = $('#paneSend');
    els.recBody = $('#recBody');
    els.modal = $('#modal');
    els.modalCard = $('#modalCard');
    els.toast = $('#toast');
    els.currentVersion = $('#currentVersion');

    bindTabs();
    bindRead();
    bindPane();
    bindRecords();
    bindSettings();
    window.ZJUpdate.setUi({
      toast: toast,
      switchTab: switchTab,
      onUpdateChange: function () {
        if (state.tab === 'home') window.ZJHome.render();
      }
    });
    window.ZJUpdate.bind();
    window.ZJHome.setUi({
      switchTab: switchTab,
      openDetail: openDetail,
      showSettingsGroup: showSettingsGroup,
      showUsage: showUsageTab,
      toast: toast
    });
    window.ZJHome.bind();
    window.ZJHome.render();
    bindAccessibility();
    bindGlobal();

    renderSettings();
    updateModelChip();
    refreshAccessibility();

    els.currentVersion.textContent = C.invoke('getVersion') || '—';
    setTimeout(function () {
      if (state.settings.autoCheckUpdates !== false && state.settings.updateUrl) {
        window.ZJUpdate.check(true);
      }
    }, 1500);

    window.__handleBack = handleBack;
    window.__filePicked = onFilePicked;
    window.__backupPicked = onBackupPicked;
    window.__openSettings = function () {
      switchTab('settings');
      return true;
    };
    window.__openCapture = function (text) {
      var value = String(text || '').trim();
      if (!value) return false;
      els.pasteText.value = value;
      startReading(value);
      switchTab('read');
      return true;
    };
    window.__refreshAccessibility = function () {
      refreshAccessibility();
      return true;
    };
  }

  function bindGlobal() {
    document.addEventListener('selectionchange', debounce(onSelectionChange, 60));
    document.addEventListener('pointerdown', function (event) {
      if (!els.selToolbar.contains(event.target)) hideToolbar();
    }, true);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (els.modal.classList.contains('show')) closeModal();
        else if (!els.answerPane.hidden) closePane();
        else hideToolbar();
      }
    });
    els.modal.addEventListener('click', function (event) {
      if (event.target === els.modal || event.target.id === 'modalScrim') closeModal();
    });
    els.paneScrim.addEventListener('click', function () { closePane(); });
    window.addEventListener('resize', function () {
      hideToolbar();
      if (!els.answerPane.hidden) els.paneScrim.hidden = window.innerWidth > 900;
    });
  }

  function bindTabs() {
    els.tabs.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-tab]');
      if (button) switchTab(button.getAttribute('data-tab'));
    });
    $('#modelChip').addEventListener('click', function () {
      switchTab('settings');
      showSettingsGroup('model');
      var input = $('#apiKey');
      if (input) {
        try {
          input.focus();
          input.scrollIntoView({ block: 'center' });
        } catch (exception) {
        }
      }
    });
  }

  function switchTab(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(els.tabs.querySelectorAll('button'), function (button) {
      var on = button.getAttribute('data-tab') === tab;
      button.classList.toggle('on', on);
      button.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (view) {
      view.classList.toggle('on', view.id === 'view-' + tab);
    });
    hideToolbar();
    if (tab === 'home') window.ZJHome.render();
    if (tab === 'records') renderRecords();
    if (tab === 'settings') renderSettings();
  }

  function bindRead() {
    $('#startRead').addEventListener('click', function () {
      startReading(els.pasteText.value);
    });
    $('#backHome').addEventListener('click', showHome);
    $('#pickFile').addEventListener('click', function () {
      var id = C.uid('file');
      window.__pendingFileId = id;
      C.invoke('pickTextFile', id);
      toast('选择文本文件…');
    });
    els.docWrap.addEventListener('scroll', hideToolbar);
  }

  function onFilePicked(id, text) {
    if (!text) {
      toast('没有读到文字，或文件超过 2MB。');
      return;
    }
    els.pasteText.value = text;
    startReading(text);
  }

  function onBackupPicked(text) {
    var backup = null;
    try {
      backup = JSON.parse(text || '');
    } catch (exception) {
      backup = null;
    }
    if (!backup || backup.format !== 'zhujie-backup'
        || !Array.isArray(backup.history)
        || !Array.isArray(backup.favorites)
        || !Array.isArray(backup.usage)) {
      toast('这个文件不是注解的备份。');
      return;
    }
    var history = C.mergeRecords(C.getHistory(), backup.history, 500);
    var favorites = C.mergeRecords(C.getFavorites(), backup.favorites, 200);
    var usage = C.mergeRecords(C.getUsage(), backup.usage, 1000);
    var result = C.invoke('importRecords',
      JSON.stringify(history), JSON.stringify(favorites), JSON.stringify(usage));
    if (!result) {
      toast('导入失败：备份写回本机时出错。');
      return;
    }
    var parts = String(result).split('/');
    toast('已恢复：历史 ' + (parts[0] || 0) + ' 条、收藏 ' + (parts[1] || 0)
      + ' 条、用量 ' + (parts[2] || 0) + ' 条。Key 不在备份里，需要重新填一次。');
    if (state.tab === 'records') renderRecords();
    if (state.tab === 'home') window.ZJHome.render();
  }

  function startReading(text) {
    var value = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!value) {
      toast('先粘贴一段文字。');
      return;
    }
    var blocks = value.split(/\n{2,}/).map(function (item) {
      return item.trim();
    }).filter(Boolean);
    if (blocks.length <= 1) {
      blocks = value.split(/\n+/).map(function (item) {
        return item.trim();
      }).filter(Boolean);
    }
    state.reader = {
      text: value,
      blocks: blocks,
      title: cleanTitle(blocks[0] || value)
    };
    els.doc.innerHTML = blocks.map(function (block) {
      return '<p>' + C.escapeHtml(block).replace(/\n/g, '<br>') + '</p>';
    }).join('');
    els.docTitle.textContent = state.reader.title;
    els.readerMeta.textContent = value.length + ' 字 · ' + blocks.length + ' 段';
    els.readHome.hidden = true;
    els.reader.hidden = false;
    els.docWrap.scrollTop = 0;
    closePane(true);
    hideToolbar();
  }

  function cleanTitle(text) {
    var value = String(text || '').replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim();
    return value.length > 28 ? value.slice(0, 28) + '…' : (value || '阅读');
  }

  function showHome() {
    closePane(true);
    els.reader.hidden = true;
    els.readHome.hidden = false;
    hideToolbar();
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  function onSelectionChange() {
    if (els.reader.hidden) {
      hideToolbar();
      return;
    }
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      onEmptySelection();
      return;
    }
    var text = selection.toString().trim();
    if (!text) {
      hideToolbarSoon();
      return;
    }
    var truncated = text.length > 2000;
    if (truncated) {
      text = text.slice(0, 2000);
    }
    var anchor = selection.anchorNode;
    var node = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
    if (!node || !els.doc.contains(node)) {
      hideToolbarSoon();
      return;
    }
    var paragraph = node.closest ? node.closest('p') : null;
    var index = paragraph ? Array.prototype.indexOf.call(els.doc.children, paragraph) : -1;
    var context = index >= 0
      ? state.reader.blocks.slice(Math.max(0, index - 1), index + 2).join('\n\n')
      : '';
    context = context.slice(0, 300);
    var rect = null;
    try {
      rect = selection.getRangeAt(0).getBoundingClientRect();
    } catch (exception) {
      rect = null;
    }
    if (!rect || (!rect.width && !rect.height)) {
      rect = paragraph ? paragraph.getBoundingClientRect() : null;
    }
    if (!rect) {
      hideToolbarSoon();
      return;
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
    var left = rect.left + rect.width / 2;
    left = Math.max(90, Math.min(left, window.innerWidth - 90));
    var top = rect.top - 46;
    if (top < 8) top = rect.bottom + 10;
    els.selToolbar.style.left = left + 'px';
    els.selToolbar.style.top = top + 'px';
    els.selToolbar.classList.add('show');
    toolbarShownAt = Date.now();
    clearTimeout(toolbarHideTimer);
  }

  function hideToolbar() {
    clearTimeout(toolbarHideTimer);
    els.selToolbar.classList.remove('show');
  }

  function hideToolbarSoon() {
    clearTimeout(toolbarHideTimer);
    toolbarHideTimer = setTimeout(hideToolbar, 700);
  }

  function onEmptySelection() {
    if (Date.now() - toolbarShownAt < 1200) return;
    hideToolbarSoon();
  }

  function bindPane() {
    els.selToolbar.addEventListener('pointerdown', function (event) {
      var button = event.target.closest('button[data-mode]');
      if (!button) return;
      event.preventDefault();
      var mode = button.getAttribute('data-mode');
      var selection = state.selection;
      hideToolbar();
      if (!selection) {
        toast('先选中一段文字。');
        return;
      }
      openPane(mode, selection);
    });

    $('#paneClose').addEventListener('click', function () { closePane(); });
    els.paneSend.addEventListener('click', function () {
      if (state.pane.streaming) {
        C.cancel(state.pane.id);
      } else {
        sendFollowUp();
      }
    });
    els.paneInput.addEventListener('keydown', function (event) {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        sendFollowUp();
      }
    });
  }

  function openPane(mode, selection) {
    var text = String(selection.text || '').trim();
    if (!text) {
      toast('先选中一段文字。');
      return;
    }
    var settings = C.getSettings();
    state.settings = settings;
    var provider = C.getProvider(settings);
    state.pane = {
      mode: mode,
      lastMode: mode,
      text: text,
      truncated: !!selection.truncated,
      context: String(selection.context || '').slice(0, 300),
      turns: [],
      id: null,
      streaming: false,
      answer: '',
      question: '',
      started: 0,
      rec: null
    };

    els.paneIcon.textContent = mode === 'ask' ? '问' : '注';
    els.paneTitle.textContent = mode === 'ask' ? '提问' : '注解';
    els.paneSub.textContent = state.pane.context ? '已结合当前段落' : '仅选中文字';
    els.paneModel.textContent = provider.name + ' · '
      + C.modelLabel(C.modelOf(settings), provider.id);
    els.paneQuote.textContent = text;
    els.paneMeta.innerHTML = '<span class="chip">选中 ' + text.length + ' 字</span>'
      + (state.pane.truncated ? '<span class="chip">超长，已取前 2000 字</span>' : '')
      + (state.pane.context
        ? '<span class="chip">上下文 ' + state.pane.context.length + ' 字</span>'
        : '<span class="chip">无上下文</span>');
    els.paneAnswer.innerHTML = '';
    els.paneError.hidden = true;
    els.paneError.innerHTML = '';
    els.paneEmpty.hidden = mode !== 'ask';
    if (mode === 'ask') els.paneEmpty.textContent = '选中文字已带上，直接问你想知道的。';
    els.paneInput.value = '';
    els.paneInput.placeholder = mode === 'ask' ? '就问这段文字…' : '继续追问…';
    els.answerPane.hidden = false;
    els.paneScrim.hidden = window.innerWidth > 900;
    els.paneSend.disabled = false;
    els.paneAnswer.scrollTop = 0;

    if (mode === 'ask') {
      setTimeout(function () { els.paneInput.focus(); }, 220);
    } else {
      run(null);
    }
  }

  function run(question) {
    var pane = state.pane;
    if (!pane.text) return;
    if (pane.streaming) {
      toast('等这次回答结束。');
      return;
    }
    var settings = C.getSettings();
    state.settings = settings;
    updateModelChip();
    var provider = C.getProvider(settings);
    if (!C.keyOf(settings)) {
      showPaneError('还没填 API Key。先去「设置」里粘贴 Key，再回来。');
      return;
    }
    if (!settings.model) {
      showPaneError('还没选模型。先去「设置」里选一个。');
      return;
    }

    pane.lastMode = question ? 'ask' : 'annotate';
    if (pane.question || pane.answer) {
      pane.turns.push({ question: pane.question, answer: pane.answer });
      if (pane.turns.length > 8) pane.turns.shift();
    }
    pane.question = question || '';
    pane.answer = '';
    pane.started = Date.now();
    pane.streaming = true;
    pane.id = null;
    els.paneAnswer.innerHTML = '';
    els.paneError.hidden = true;
    els.paneError.innerHTML = '';
    els.paneEmpty.hidden = true;
    els.paneMeta.innerHTML = '<span class="chip">选中 ' + pane.text.length + ' 字</span>'
      + (pane.context ? '<span class="chip">上下文 ' + pane.context.length + ' 字</span>' : '')
      + '<span class="chip">正在回答…</span>';
    els.paneSend.disabled = false;
    els.paneSend.textContent = '停止';
    renderAnswer();

    var request = C.buildRequest(pane.lastMode, pane.text, pane.context, pane.question, pane.turns, settings);
    var id = C.chat(request, {
      onDelta: function (piece) {
        if (pane.id !== id) return;
        pane.answer += piece;
        scheduleRender();
      },
      onDone: function (usage) {
        if (pane.id !== id) return;
        finish(usage, null, id);
      },
      onError: function (message) {
        if (pane.id !== id) return;
        finish(null, message, id);
      }
    });
    pane.id = id;
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
    var pane = state.pane;
    var body = els.paneAnswer.parentElement;
    var nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 140;
    var html = C.threadHtml(pane.turns, pane.question, pane.answer, pane.streaming);
    els.paneAnswer.innerHTML = html;
    els.paneEmpty.hidden = !!(pane.answer || pane.streaming);
    if (nearBottom) body.scrollTop = body.scrollHeight;
  }

  function finish(usage, error, id) {
    var pane = state.pane;
    pane.streaming = false;
    pane.id = null;
    els.paneSend.disabled = false;
    els.paneSend.textContent = '发送';
    var elapsed = Date.now() - pane.started;

    if (error) {
      var rec = C.record(pane.lastMode, pane.text, pane.question, pane.answer, null, elapsed,
        pane.context.length, error);
      pane.rec = rec;
      renderAnswer();
      showPaneError(error);
      els.paneMeta.innerHTML = '<span class="chip">请求失败</span>';
      return;
    }

    var record = C.record(pane.lastMode, pane.text, pane.question, pane.answer, usage, elapsed,
      pane.context.length, null);
    pane.rec = record;
    renderAnswer();
    var cost = C.formatCost(record.cost);
    els.paneMeta.innerHTML = '<span class="chip">选中 ' + pane.text.length + ' 字</span>'
      + (pane.context ? '<span class="chip">上下文 ' + pane.context.length + ' 字</span>' : '')
      + '<span class="chip">' + C.formatTokens(record.totalTokens) + ' tokens</span>'
      + '<span class="chip">' + cost + (usage && usage.estimated ? ' 估算' : '') + '</span>'
      + '<span class="chip">已存历史</span>';
  }

  function showPaneError(message) {
    els.paneError.innerHTML = C.escapeHtml(message)
      + '<br><button class="btn small" id="paneRetry">重试</button>'
      + '<button class="btn small" id="paneGoSettings">打开设置</button>';
    els.paneError.hidden = false;
    var retry = $('#paneRetry');
    if (retry) retry.addEventListener('click', function () { run(state.pane.question || null); });
    var button = $('#paneGoSettings');
    if (button) button.addEventListener('click', function () { switchTab('settings'); });
  }

  function sendFollowUp() {
    if (state.pane.streaming) {
      toast('等这次回答结束。');
      return;
    }
    var question = els.paneInput.value.trim();
    if (!question) {
      toast('先写下你的问题。');
      return;
    }
    els.paneInput.value = '';
    run(question);
  }

  function closePane(silent) {
    var pane = state.pane;
    if (pane.streaming && pane.id) C.cancel(pane.id);
    state.pane = {
      mode: null,
      lastMode: 'annotate',
      text: '',
      context: '',
      turns: [],
      id: null,
      streaming: false,
      answer: '',
      question: '',
      started: 0,
      rec: null
    };
    els.answerPane.hidden = true;
    els.paneScrim.hidden = true;
    els.paneAnswer.innerHTML = '';
    els.paneError.hidden = true;
    els.paneError.innerHTML = '';
    els.paneEmpty.hidden = true;
    els.paneQuote.textContent = '';
    els.paneMeta.innerHTML = '';
    els.paneInput.value = '';
    els.paneSend.disabled = false;
    els.paneSend.textContent = '发送';
    if (!silent) hideToolbar();
  }

  function handleBack() {
    if (!els.answerPane.hidden) {
      closePane();
      return true;
    }
    if (!els.reader.hidden) {
      showHome();
      return true;
    }
    if (state.tab !== 'home') {
      switchTab('home');
      return true;
    }
    return false;
  }

  function bindRecords() {
    window.addEventListener('zj:favorites-changed', function () {
      if (state.tab === 'records') renderRecords();
    });
    document.querySelector('#recSeg').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-rec]');
      if (!button) return;
      state.recTab = button.getAttribute('data-rec');
      Array.prototype.forEach.call(button.parentElement.children, function (item) {
        var on = item === button;
        item.classList.toggle('on', on);
        item.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      renderRecords();
    });

    els.recBody.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-remove]');
      if (remove) {
        C.removeFavorite(remove.getAttribute('data-remove'));
        toast('已从收藏移除。');
        renderRecords();
        return;
      }
      var card = event.target.closest('.rec-card');
      if (!card) return;
      var id = card.getAttribute('data-id');
      var record = null;
      for (var i = 0; i < state.currentList.length; i++) {
        if (state.currentList[i].id === id) {
          record = state.currentList[i];
          break;
        }
      }
      if (record) openDetail(record);
    });
  }

  function showUsageTab() {
    state.recTab = 'usage';
    Array.prototype.forEach.call(document.querySelectorAll('#recSeg button'), function (item) {
      var on = item.getAttribute('data-rec') === 'usage';
      item.classList.toggle('on', on);
      item.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    switchTab('records');
  }

  function renderRecords() {
    if (state.recTab === 'usage') {
      renderUsage();
      return;
    }
    var list = state.recTab === 'history' ? C.getHistory() : C.getFavorites();
    state.currentList = list;
    if (!list.length) {
      els.recBody.innerHTML = '<div class="empty">'
        + (state.recTab === 'history'
          ? '还没有记录。选中文字注解一次，就会出现在这里。'
          : '还没有收藏。答案里的「收藏」会存到这里。')
        + '</div>';
      return;
    }
    els.recBody.innerHTML = '<div class="records-list">'
      + list.map(state.recTab === 'favorites' ? favoriteCard : recordCard).join('') + '</div>';
  }

  function favoriteCard(record) {
    var ask = record.mode === 'ask';
    var title = record.title
      || (record.question || record.text || '').replace(/\s+/g, ' ').trim().slice(0, 30)
      || '收藏';
    return '<article class="rec-card fav-card" data-id="' + C.escapeHtml(record.id) + '">'
      + '<div class="rec-top"><span class="badge' + (ask ? ' ask' : '') + '">'
      + (ask ? '提问' : '注解') + '</span><span>' + C.escapeHtml(C.formatTime(record.ts)) + '</span></div>'
      + '<div class="rec-title">' + C.escapeHtml(title) + '</div>'
      + '<div class="rec-hint">点开看回答</div>'
      + '<div class="rec-foot"><span>' + C.formatTokens(record.totalTokens) + ' tokens</span>'
      + '<span>' + C.formatCost(record.cost) + '</span><span class="spacer"></span>'
      + '<button class="rec-remove" data-remove="' + C.escapeHtml(record.id) + '">移除</button></div>'
      + '</article>';
  }

  function recordCard(record) {
    var ask = record.mode === 'ask';
    var remove = state.recTab === 'favorites'
      ? '<button class="rec-remove" data-remove="' + C.escapeHtml(record.id) + '">移除</button>'
      : '';
    return '<article class="rec-card" data-id="' + C.escapeHtml(record.id) + '">'
      + '<div class="rec-top"><span class="badge' + (ask ? ' ask' : '') + '">'
      + (ask ? '提问' : '注解') + '</span><span>' + C.escapeHtml(C.formatTime(record.ts))
      + '</span><span>' + C.escapeHtml(record.model || '') + '</span></div>'
      + '<div class="rec-text">' + C.escapeHtml(record.text || '') + '</div>'
      + '<div class="rec-answer">' + C.escapeHtml(record.answer || record.error || '') + '</div>'
      + '<div class="rec-foot"><span>' + C.formatTokens(record.totalTokens) + ' tokens</span>'
      + '<span>' + C.formatCost(record.cost) + '</span><span class="spacer"></span>' + remove + '</div>'
      + '</article>';
  }

  function renderUsage() {
    var usage = C.getUsage();
    if (!usage.length) {
      els.recBody.innerHTML = '<div class="empty">还没有用量。回答一次后，这里会统计 token 和估算花费。</div>';
      return;
    }
    var todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    var todayCount = 0;
    var totalTokens = 0;
    var totalCost = 0;
    var byModel = {};
    usage.forEach(function (record) {
      if (record.ts >= todayStart.getTime()) todayCount++;
      totalTokens += record.totalTokens || 0;
      totalCost += record.cost || 0;
      var key = record.model || '未知模型';
      if (!byModel[key]) byModel[key] = { requests: 0, tokens: 0, cost: 0 };
      byModel[key].requests++;
      byModel[key].tokens += record.totalTokens || 0;
      byModel[key].cost += record.cost || 0;
    });

    var models = Object.keys(byModel).sort(function (a, b) {
      return byModel[b].cost - byModel[a].cost;
    });
    var modelRows = models.map(function (name) {
      var item = byModel[name];
      return '<div class="usage-row"><span class="name">' + C.escapeHtml(name) + '</span>'
        + '<span class="num">' + item.requests + ' 次</span>'
        + '<span class="num">' + C.formatTokens(item.tokens) + ' tokens</span>'
        + '<span class="num">' + C.formatCost(item.cost) + '</span></div>';
    }).join('');

    var recent = usage.slice(0, 20).map(function (record) {
      return '<div class="usage-row"><span class="name">' + C.escapeHtml(record.text || '')
        + '</span><span class="num">' + C.escapeHtml(C.formatTime(record.ts)) + '</span>'
        + '<span class="num">' + C.formatTokens(record.totalTokens) + '</span>'
        + '<span class="num">' + C.formatCost(record.cost) + '</span></div>';
    }).join('');

    els.recBody.innerHTML = '<div class="stats">'
      + '<div class="stat"><b>' + todayCount + '</b><span>今天请求</span></div>'
      + '<div class="stat"><b>' + C.formatTokens(totalTokens) + '</b><span>累计 tokens</span></div>'
      + '<div class="stat"><b>' + C.formatCost(totalCost) + '</b><span>累计估算花费</span></div>'
      + '</div><div class="usage-title">按模型</div><div class="usage-table">' + modelRows + '</div>'
      + '<div class="usage-title">最近 20 次</div><div class="usage-table">' + recent + '</div>';
  }

  function openDetail(record) {
    var ask = record.mode === 'ask';
    var already = C.getFavorites().some(function (item) {
      return item.text === record.text && (item.question || '') === (record.question || '');
    });
    els.modalCard.innerHTML = '<div class="modal-head">'
      + '<span class="badge' + (ask ? ' ask' : '') + '">' + (ask ? '提问' : '注解') + '</span>'
      + '<b>' + C.escapeHtml(record.providerName || '') + ' · ' + C.escapeHtml(record.model || '') + '</b>'
      + '<span class="meta">' + C.escapeHtml(C.formatTime(record.ts)) + '</span>'
      + '<button class="icon-btn" data-close="1" aria-label="关闭">×</button></div>'
      + '<div class="modal-body"><div class="quote">' + C.escapeHtml(record.text || '') + '</div>'
      + (record.question ? '<p class="note">问题：' + C.escapeHtml(record.question) + '</p>' : '')
      + '<div class="md" style="margin-top:12px">' + C.renderMarkdown(record.answer || record.error || '') + '</div>'
      + '<div class="modal-actions"><button class="btn small" id="detailCopy">复制答案</button>'
      + '<button class="btn small" id="detailFavorite">' + (already ? '已收藏' : '收藏') + '</button>'
      + '<button class="btn small ghost" data-close="1">关闭</button></div>'
      + '<p class="note">' + C.formatTokens(record.totalTokens) + ' tokens · '
      + C.formatCost(record.cost) + '</p></div>';
    els.modal.classList.add('show');
    els.modalCard.querySelectorAll('[data-close]').forEach(function (button) {
      button.addEventListener('click', closeModal);
    });
    $('#detailCopy').addEventListener('click', function () {
      C.invoke('copy', record.answer || '');
      toast('已复制。');
    });
    $('#detailFavorite').addEventListener('click', function () {
      if (already) {
        toast('已经收藏过了。');
        return;
      }
      C.addFavorite(record);
      toast('已收藏。');
      if (state.recTab === 'favorites') renderRecords();
    });
  }

  function closeModal() {
    els.modal.classList.remove('show');
    els.modalCard.innerHTML = '';
  }

  function showSettingsGroup(group) {
    Array.prototype.forEach.call(document.querySelectorAll('#settingsSeg button'), function (item) {
      var on = item.getAttribute('data-set') === group;
      item.classList.toggle('on', on);
      item.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.set-group'), function (g) {
      g.classList.toggle('on', g.id === 'set-' + group);
    });
  }

  function bindSettings() {
    document.querySelector('#settingsSeg').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-set]');
      if (button) showSettingsGroup(button.getAttribute('data-set'));
    });
    document.querySelector('#providers').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-provider]');
      if (!button) return;
      var id = button.getAttribute('data-provider');
      var provider = null;
      for (var i = 0; i < ZJ_PRESETS.length; i++) {
        if (ZJ_PRESETS[i].id === id) {
          provider = ZJ_PRESETS[i];
          break;
        }
      }
      if (!provider) return;
      var oldId = state.settings.providerId;
      var typedKey = $('#apiKey').value.trim();
      if (typedKey) {
        state.settings.keys = state.settings.keys || {};
        state.settings.keys[oldId] = typedKey;
        C.saveSettings(state.settings);
      }
      state.settings.providerId = id;
      state.settings.model = provider.models[0];
      renderSettings();
    });

    $('#modelSelect').addEventListener('change', function () {
      state.settings.model = $('#modelSelect').value;
      updateModelChip();
    });

    $('#saveSettings').addEventListener('click', function () {
      saveSettingsForm(true);
    });

    $('#syncDesktopPrompt').addEventListener('click', function () {
      if (!window.confirm('用电脑端提示词覆盖当前提示词？')) return;
      $('#customPrompt').value = window.ZJ_DEFAULT_PROMPT || '';
      saveSettingsForm(true);
    });
    $('#restorePrompt').addEventListener('click', function () {
      var backup = state.settings.promptBackup;
      if (!backup) return;
      $('#customPrompt').value = backup;
      state.settings.promptBackup = '';
      saveSettingsForm(true);
    });

    $('#testKey').addEventListener('click', function () {
      var settings = saveSettingsForm(false);
      if (!C.keyOf(settings)) {
        toast('先填 API Key。');
        return;
      }
      var button = $('#testKey');
      var label = button.textContent;
      var status = $('#testStatus');
      button.disabled = true;
      button.textContent = '测试中…';
      if (status) {
        status.className = 'hint';
        status.textContent = '正在测试连接…';
      }
      C.testConnection(settings, function (error, reply) {
        button.disabled = false;
        button.textContent = label;
        if (error) {
          if (status) {
            status.className = 'hint bad';
            status.textContent = '连接失败：' + error;
          }
          toast('连接失败：' + error);
        } else {
          var text = '连接成功：' + String(reply || 'OK').slice(0, 24);
          if (status) {
            status.className = 'hint ok';
            status.textContent = text;
          }
          toast(text);
        }
      });
    });

    $('#keyHelp').addEventListener('click', function () {
      var provider = C.getProvider(state.settings);
      if (provider.keyUrl) C.invoke('openUrl', provider.keyUrl);
      else toast('这个服务商没有配置获取 Key 的地址。');
    });

    $('#clearRecords').addEventListener('click', function () {
      if (!window.confirm('确定清空历史、收藏和用量？这个操作不能撤销。')) return;
      C.invoke('clearRecords');
      state.currentList = [];
      toast('已清空。');
      if (state.tab === 'records') renderRecords();
    });

    $('#exportBackup').addEventListener('click', function () {
      C.invoke('exportBackup');
    });
    $('#importBackup').addEventListener('click', function () {
      C.invoke('importBackup');
    });
  }

  function bindAccessibility() {
    $('#openAccessibility').addEventListener('click', function () {
      C.invoke('openAccessibilitySettings');
    });
    $('#openAppInfo').addEventListener('click', function () {
      C.invoke('openAppInfo');
    });
    $('#copyChip').addEventListener('change', function () {
      state.settings.copyChip = this.checked;
      C.saveSettings(state.settings);
    });
    $('#ocrEnabled').addEventListener('change', function () {
      state.settings.ocrEnabled = this.checked;
      C.saveSettings(state.settings);
    });
    $('#captureMaster').addEventListener('change', function () {
      C.invoke('setCaptureMaster', this.checked);
      refreshCaptureStatus();
    });
    $('#enableCapture').addEventListener('click', function () {
      var connected = C.invoke('isAccessibilityConnected') === 'true';
      if (!connected) {
        C.invoke('openAccessibilitySettings');
        toast('先开启无障碍服务，再回来点「开启划」。');
        return;
      }
      C.invoke('enableCapture');
      refreshCaptureStatus();
      toast('已开启「划」。');
    });
    window.addEventListener('focus', refreshAccessibility);
  }

  function refreshCaptureStatus() {
    var el = $('#captureStatus');
    var btn = $('#enableCapture');
    if (!el) return;
    var connected = C.invoke('isAccessibilityConnected') === 'true';
    var captureOn = C.invoke('isCaptureEnabled') === 'true';
    if (!connected) {
      el.textContent = '无障碍未开启';
      el.className = 'hint';
    } else if (captureOn) {
      el.textContent = '划已开启';
      el.className = 'hint ok';
    } else {
      el.textContent = '划已关闭，点按钮恢复';
      el.className = 'hint bad';
    }
    if (btn) {
      btn.disabled = !connected || captureOn;
      btn.textContent = captureOn ? '划已开启' : '开启「划」';
    }
  }

  function refreshAccessibility() {
    var enabled = C.invoke('isAccessibilityEnabled') === 'true';
    var connected = C.invoke('isAccessibilityConnected') === 'true';
    var status = $('#accessStatus');
    if (status) {
      if (!enabled) {
        status.textContent = '未开启';
        status.className = 'hint';
      } else if (!connected) {
        status.textContent = '已开启，服务未连接（关掉再开一次）';
        status.className = 'hint bad';
      } else {
        status.textContent = '已开启';
        status.className = 'hint ok';
      }
    }
    var button = $('#openAccessibility');
    if (button) button.textContent = enabled ? '去设置' : '去开启';
    refreshCaptureStatus();
  }

  function saveSettingsForm(showToast) {
    var settings = state.settings;
    settings.providerId = settings.providerId || 'qwen';
    settings.model = $('#modelSelect').value;
    settings.prompt = $('#customPrompt').value.trim();
    settings.customBaseUrl = $('#customBaseUrl').value.trim();
    settings.customModel = $('#customModel').value.trim();
    settings.keys = settings.keys || {};
    var key = $('#apiKey').value.trim();
    if (key) settings.keys[settings.providerId] = key;
    else delete settings.keys[settings.providerId];
    delete settings.apiKey;
    settings.updateUrl = OFFICIAL_UPDATE_URL;
    settings.autoCheckUpdates = $('#autoUpdate').checked;
    settings.copyChip = $('#copyChip').checked;
    settings.ocrEnabled = $('#ocrEnabled').checked;
    C.saveSettings(settings);
    state.settings = settings;
    updateModelChip();
    if (showToast) toast('已保存。');
    return settings;
  }

  function renderSettings() {
    var settings = state.settings;
    var provider = C.getProvider(settings);
    var providerBox = $('#providers');
    providerBox.innerHTML = ZJ_PRESETS.map(function (item) {
      return '<button class="provider' + (item.id === provider.id ? ' on' : '') + '" data-provider="'
        + C.escapeHtml(item.id) + '"><b>' + C.escapeHtml(item.name) + '</b><span>'
        + C.escapeHtml(item.tagline) + '</span></button>';
    }).join('');

    var models = provider.models.slice();
    if (settings.model && models.indexOf(settings.model) < 0) models.push(settings.model);
    $('#modelSelect').innerHTML = models.map(function (model) {
      return '<option value="' + C.escapeHtml(model) + '"'
        + (model === settings.model ? ' selected' : '') + '>'
        + C.escapeHtml(C.modelOptionLabel(model, provider.id)) + '</option>';
    }).join('');

    var key = (settings.keys && settings.keys[provider.id]) || '';
    $('#apiKey').value = key;
    $('#apiKey').placeholder = provider.keyHint ? ('例如 ' + provider.keyHint) : '粘贴你的 Key';
    $('#keyHint').textContent = provider.tagline + (provider.keyHint ? ' · ' + provider.keyHint : '');
    $('#customPrompt').value = settings.prompt || '';
    $('#restorePrompt').hidden = !settings.promptBackup;
    $('#customBaseUrl').value = settings.customBaseUrl || '';
    $('#customModel').value = settings.customModel || '';
    $('#keyHelp').disabled = !provider.keyUrl;
    refreshAccessibility();
    if (els.currentVersion) els.currentVersion.textContent = C.invoke('getVersion') || '—';
    $('#autoUpdate').checked = settings.autoCheckUpdates !== false;
    $('#copyChip').checked = settings.copyChip !== false;
    $('#ocrEnabled').checked = settings.ocrEnabled !== false;
    $('#captureMaster').checked = C.invoke('isCaptureMaster') === 'true';
    $('#updateUrl').value = OFFICIAL_UPDATE_URL;
    window.ZJUpdate.syncView();
    updateModelChip();
  }

  function updateModelChip() {
    var settings = state.settings || C.getSettings();
    var provider = C.getProvider(settings);
    var chip = $('#modelChip');
    var badge = $('#topModelMult');
    if (!C.keyOf(settings)) {
      chip.textContent = '未配置 Key · 点设置';
      chip.classList.add('warn');
      if (badge) badge.hidden = true;
      return;
    }
    var model = C.modelOf(settings);
    chip.textContent = provider.name + ' · ' + C.modelLabel(model, provider.id);
    chip.classList.remove('warn');
    if (badge) {
      var value = C.usageMultiplier(model);
      badge.textContent = C.formatUsageMultiplier(value);
      badge.className = 'mult-badge ' + C.multiplierTone(value);
      badge.hidden = false;
    }
  }

  function toast(message) {
    els.toast.textContent = message || '';
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 2400);
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState === 'interactive' || document.readyState === 'complete') init();
})();
