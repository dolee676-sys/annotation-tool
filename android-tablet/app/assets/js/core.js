(function () {
  var Native = window.AndroidBridge || null;
  var listeners = new Map();
  var mockTimers = new Map();
  var seq = 0;

  window.__aiDelta = function (id, piece) {
    var handler = listeners.get(id);
    if (handler && handler.onDelta) handler.onDelta(piece);
  };
  window.__aiDone = function (id, usage) {
    var handler = listeners.get(id);
    if (!handler) return;
    listeners.delete(id);
    if (handler.onDone) handler.onDone(usage || {});
  };
  window.__aiError = function (id, message) {
    var handler = listeners.get(id);
    if (!handler) return;
    listeners.delete(id);
    if (handler.onError) handler.onError(message || '请求失败');
  };

  function mockChat(requestJson, id) {
    var request;
    try {
      request = JSON.parse(requestJson);
    } catch (exception) {
      window.__aiError(id, '请求参数格式错误。');
      return;
    }
    var isAsk = (request.user || '').indexOf('【用户当前的问题】') >= 0;
    var answer = isAsk
      ? '（浏览器预览 · 未连接模型）\n\n注意力残留和普通走神的区别在于：走神是注意力自己飘走；注意力残留是任务切换后，上一件事“没退干净”。所以代价不是切换那几秒，而是接下来一段时间的判断力。'
      : '（浏览器预览 · 未连接模型）\n\n**词义**：任务切换后，上一件事的思考痕迹仍滞留在工作记忆里，持续占用认知资源。\n\n**在当前语境**：作者用它解释，哪怕只瞄一眼消息，回到原文时理解力也已经下降。\n\n**作用**：把“被打断”从时间损失改写成认知成本，支撑“深度工作需要整块时间”的论点。';
    var index = 0;
    var timer = setInterval(function () {
      if (index >= answer.length) {
        clearInterval(timer);
        mockTimers.delete(id);
        var promptTokens = 120;
        var completionTokens = Math.max(1, Math.round(answer.length * 0.7));
        window.__aiDone(id, {
          promptTokens: promptTokens,
          completionTokens: completionTokens,
          totalTokens: promptTokens + completionTokens,
          estimated: true,
          latencyMs: 900
        });
        return;
      }
      var piece = answer.slice(index, index + 4);
      index += 4;
      window.__aiDelta(id, piece);
    }, 24);
    mockTimers.set(id, timer);
  }

  var Mock = {
    getSettings: function () {
      return localStorage.getItem('zj.settings') || '';
    },
    saveSettings: function (json) {
      localStorage.setItem('zj.settings', json);
    },
    getHistory: function () {
      return localStorage.getItem('zj.history') || '[]';
    },
    addHistory: function (json) {
      var list = [];
      try { list = JSON.parse(localStorage.getItem('zj.history') || '[]'); } catch (exception) { list = []; }
      list.unshift(JSON.parse(json));
      localStorage.setItem('zj.history', JSON.stringify(list.slice(0, 500)));
    },
    getFavorites: function () {
      return localStorage.getItem('zj.favorites') || '[]';
    },
    addFavorite: function (json) {
      var list = [];
      try { list = JSON.parse(localStorage.getItem('zj.favorites') || '[]'); } catch (exception) { list = []; }
      list.unshift(JSON.parse(json));
      localStorage.setItem('zj.favorites', JSON.stringify(list.slice(0, 200)));
    },
    removeFavorite: function (id) {
      var list = [];
      try { list = JSON.parse(localStorage.getItem('zj.favorites') || '[]'); } catch (exception) { list = []; }
      localStorage.setItem('zj.favorites', JSON.stringify(list.filter(function (item) {
        return item.id !== id;
      })));
    },
    getUsage: function () {
      return localStorage.getItem('zj.usage') || '[]';
    },
    addUsage: function (json) {
      var list = [];
      try { list = JSON.parse(localStorage.getItem('zj.usage') || '[]'); } catch (exception) { list = []; }
      list.unshift(JSON.parse(json));
      localStorage.setItem('zj.usage', JSON.stringify(list.slice(0, 1000)));
    },
    clearRecords: function () {
      localStorage.setItem('zj.history', '[]');
      localStorage.setItem('zj.favorites', '[]');
      localStorage.setItem('zj.usage', '[]');
    },
    importRecords: function (historyJson, favoritesJson, usageJson) {
      try {
        var history = mergeRecords(JSON.parse(localStorage.getItem('zj.history') || '[]'), JSON.parse(historyJson), 500);
        var favorites = mergeRecords(JSON.parse(localStorage.getItem('zj.favorites') || '[]'), JSON.parse(favoritesJson), 200);
        var usage = mergeRecords(JSON.parse(localStorage.getItem('zj.usage') || '[]'), JSON.parse(usageJson), 1000);
        localStorage.setItem('zj.history', JSON.stringify(history));
        localStorage.setItem('zj.favorites', JSON.stringify(favorites));
        localStorage.setItem('zj.usage', JSON.stringify(usage));
        return history.length + '/' + favorites.length + '/' + usage.length;
      } catch (exception) {
        return '';
      }
    },
    chat: function (requestJson, id) {
      mockChat(requestJson, id);
    },
    cancel: function (id) {
      var timer = mockTimers.get(id);
      if (timer) clearInterval(timer);
      mockTimers.delete(id);
    },
    panelInit: function () {
      var query = new URLSearchParams(location.search);
      return JSON.stringify({
        mode: query.get('mode') === 'ask' ? 'ask' : 'annotate',
        text: query.get('text') || '注意力残留'
      });
    },
    copy: function (text) {
      if (navigator.clipboard) navigator.clipboard.writeText(text);
    },
    toast: function (message) {
      console.log('[toast]', message);
    },
    closePanel: function () {
      if (history.length > 1) history.back();
    },
    openMain: function () {
      location.href = 'index.html';
    },
    pickTextFile: function (id) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'text/*';
      input.onchange = function () {
        var file = input.files && input.files[0];
        if (!file) {
          window.__filePicked(id, null);
          return;
        }
        var reader = new FileReader();
        reader.onload = function () { window.__filePicked(id, String(reader.result || '')); };
        reader.onerror = function () { window.__filePicked(id, null); };
        reader.readAsText(file, 'utf-8');
      };
      input.click();
    },
    openUrl: function (url) {
      window.open(url, '_blank');
    },
    getVersion: function () {
      return '0.1.1 (2)';
    },
    checkUpdate: function (manifestUrl, id) {
      setTimeout(function () {
        if (window.__updateResult) {
          window.__updateResult(id, {
            available: true,
            currentVersion: '0.1.1 (2)',
            latestVersion: '0.1.2',
            versionCode: 3,
            notes: '浏览器预览：模拟新版本。',
            url: manifestUrl,
            sha256: 'demo',
            size: 190000
          });
        }
      }, 300);
    },
    downloadUpdate: function (url, sha, id) {
      var percent = 0;
      var timer = setInterval(function () {
        percent += 20;
        if (window.__updateProgress) window.__updateProgress(id, percent, percent * 1000, 100000);
        if (percent >= 100) {
          clearInterval(timer);
          if (window.__updateDownloaded) window.__updateDownloaded(id, 'mock://zhujie-update');
        }
      }, 200);
    },
    installUpdate: function (uri, id) {
      setTimeout(function () {
        if (window.__updateNeedPermission) window.__updateNeedPermission(id);
      }, 250);
    }
  };

  function invoke(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (Native && typeof Native[name] === 'function') {
      try {
        return Native[name].apply(Native, args);
      } catch (exception) {
        console.warn('native bridge failed:', name, exception);
      }
    }
    if (Mock[name]) {
      return Mock[name].apply(Mock, args);
    }
    return null;
  }

  function defaultSettings() {
    return {
      providerId: 'qwen',
      model: 'deepseek-v4.1-flash',
      apiKey: '',
      keys: {},
      prompt: '',
      customBaseUrl: '',
      customModel: '',
      updateUrl: 'https://api.github.com/repos/dolee676-sys/annotation-tool/contents/android-release/latest.json',
      autoCheckUpdates: true,
      copyChip: true,
      ocrEnabled: true
    };
  }

  function getSettings() {
    var stored = {};
    try {
      stored = JSON.parse(invoke('getSettings') || '{}');
    } catch (exception) {
      stored = {};
    }
    var settings = Object.assign(defaultSettings(), stored);
    if (!settings.keys || typeof settings.keys !== 'object') settings.keys = {};
    if (settings.apiKey && !settings.keys[settings.providerId]) {
      settings.keys[settings.providerId] = settings.apiKey;
    }
    if (!settings.updateUrl
        || settings.updateUrl.indexOf('://10.') >= 0
        || settings.updateUrl.indexOf('://192.168.') >= 0
        || settings.updateUrl.indexOf('releases/latest/download') >= 0
        || settings.updateUrl.indexOf('raw.githubusercontent.com') >= 0
        || settings.updateUrl.indexOf('cdn.jsdelivr.net') >= 0) {
      settings.updateUrl = defaultSettings().updateUrl;
    }
    if (!settings.promptSyncVersion || settings.promptSyncVersion < 1) {
      if (!(settings.prompt || '').trim()) {
        settings.prompt = ZJ_DEFAULT_PROMPT;
      }
      settings.promptSyncVersion = 1;
      try {
        saveSettings(settings);
      } catch (exception) {
      }
    }
    var provider = getProvider(settings);
    if (!settings.model) settings.model = provider.models[0];
    return settings;
  }

  function modelOf(settings) {
    var value = settings || getSettings();
    var custom = (value.customModel || '').trim();
    return custom || value.model;
  }

  function baseUrlOf(settings) {
    var value = settings || getSettings();
    var custom = (value.customBaseUrl || '').trim();
    return custom || getProvider(value).baseUrl;
  }

  function modelLabel(model, providerId) {
    var value = model || '';
    var pid = providerId || getSettings().providerId;
    if (pid !== 'qwen') return value;
    return /(^|[/-])(deepseek|kimi|glm|minimax|stepfun|xiaomi|unisound|antdigital)/i.test(value)
      ? value + ' · 百炼版'
      : value;
  }

  var USAGE_BASELINE_MODEL = 'deepseek-flash';

  function usageMultiplier(model) {
    var price = ZJ_PRICES[model];
    var base = ZJ_PRICES[USAGE_BASELINE_MODEL];
    if (!price || !base) return null;
    var combined = (price.in || 0) + (price.out || 0);
    var baseCombined = (base.in || 0) + (base.out || 0);
    if (baseCombined <= 0) return null;
    return combined <= 0 ? 0 : combined / baseCombined;
  }

  function formatUsageMultiplier(value) {
    if (value === null || value === undefined) return '—';
    if (value === 0) return '免费';
    if (value < 0.01) return '<0.01×';
    return value.toFixed(2) + '×';
  }

  function multiplierTone(value) {
    if (value === null || value === undefined) return 'unknown';
    if (value === 0 || value <= 0.5) return 'cheap';
    if (value >= 2) return 'high';
    return 'normal';
  }

  function modelOptionLabel(model, providerId) {
    return modelLabel(model, providerId)
      + '（' + formatUsageMultiplier(usageMultiplier(model)) + '）';
  }

  function multiplierBadge(model) {
    var value = usageMultiplier(model);
    return '<span class="mult-badge ' + multiplierTone(value) + '">'
      + escapeHtml(formatUsageMultiplier(value)) + '</span>';
  }

  function keyOf(settings) {
    var value = settings || getSettings();
    if (value.keys && value.keys[value.providerId]) return value.keys[value.providerId];
    return value.apiKey || '';
  }

  function saveSettings(settings) {
    invoke('saveSettings', JSON.stringify(settings));
  }

  function getProvider(settings) {
    var value = settings || getSettings();
    var found = null;
    for (var i = 0; i < ZJ_PRESETS.length; i++) {
      if (ZJ_PRESETS[i].id === value.providerId) {
        found = ZJ_PRESETS[i];
        break;
      }
    }
    return found || ZJ_PRESETS[0];
  }

  function buildRequest(mode, text, context, question, turns, settings) {
    var s = settings || getSettings();
    var provider = getProvider(s);
    var prompt = (s.prompt && s.prompt.trim()) || ZJ_DEFAULT_PROMPT;
    var hasContext = !!(context && context.trim());
    var system = ZJ_PROMPT.buildSystemPrompt({
      mode: mode,
      annotatePrompt: prompt,
      hasContext: hasContext,
      selectionText: text
    });
    var user = ZJ_PROMPT.buildUserMessage({
      mode: mode,
      text: text,
      question: question || '',
      context: context || '',
      turns: turns || []
    });
    return {
      baseUrl: baseUrlOf(s),
      apiKey: keyOf(s),
      model: modelOf(s),
      system: system,
      user: user
    };
  }

  function chat(request, handler) {
    var id = 'c' + (++seq) + Date.now().toString(36);
    listeners.set(id, handler);
    invoke('chat', JSON.stringify(request), id);
    return id;
  }

  function cancel(id) {
    if (!id) return;
    listeners.delete(id);
    invoke('cancel', id);
  }

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function readArray(name) {
    try {
      return JSON.parse(invoke(name) || '[]');
    } catch (exception) {
      return [];
    }
  }

  function costOf(usage, model) {
    var price = ZJ_PRICES[model] || { in: 0, out: 0 };
    if (!usage) return 0;
    return ((usage.promptTokens || 0) / 1000000) * price.in
      + ((usage.completionTokens || 0) / 1000000) * price.out;
  }

  function record(mode, text, question, answer, usage, latency, contextChars, error) {
    var settings = getSettings();
    var provider = getProvider(settings);
    var model = modelOf(settings);
    var rec = {
      id: uid('h'),
      ts: Date.now(),
      mode: mode,
      programName: '平板',
      providerName: provider.name,
      model: model,
      text: text,
      question: question || '',
      answer: answer || '',
      contextChars: contextChars || 0,
      promptTokens: usage ? usage.promptTokens || 0 : 0,
      completionTokens: usage ? usage.completionTokens || 0 : 0,
      totalTokens: usage ? usage.totalTokens || 0 : 0,
      estimated: usage ? !!usage.estimated : true,
      cost: error ? 0 : costOf(usage, model),
      latencyMs: latency || 0,
      ok: !error,
      error: error || ''
    };
    invoke('addHistory', JSON.stringify(rec));
    if (!error) invoke('addUsage', JSON.stringify(rec));
    return rec;
  }

  function addFavorite(rec) {
    var favorite = Object.assign({}, rec, {
      id: uid('f'),
      turnId: rec.id,
      ts: Date.now()
    });
    invoke('addFavorite', JSON.stringify(favorite));
    summarizeFavorite(favorite);
    return favorite;
  }

  function summarizeFavorite(favorite) {
    var settings = getSettings();
    if (!keyOf(settings)) return;
    var request = {
      baseUrl: baseUrlOf(settings),
      apiKey: keyOf(settings),
      model: modelOf(settings),
      system: '你是卡片标题概括助手。只输出一个不超过20字的中文标题，不要引号、不要解释。',
      user: '选中内容：' + String(favorite.text || '').slice(0, 300)
        + '\n问题：' + (favorite.question || '（无，直接注解）')
        + '\n回答：' + String(favorite.answer || '').slice(0, 500)
        + '\n请用不超过20字概括成卡片标题：'
    };
    var buffer = '';
    chat(request, {
      onDelta: function (piece) { buffer += piece; },
      onDone: function (usage) {
        var title = buffer.replace(/[\r\n"“”]/g, '').trim().slice(0, 40);
        if (usage) {
          var s = getSettings();
          var m = modelOf(s);
          invoke('addUsage', JSON.stringify({
            id: uid('u'), ts: Date.now(), mode: 'summarize', programName: '平板',
            providerName: getProvider(s).name, model: m,
            text: '收藏标题概括', question: '', answer: title, contextChars: 0,
            promptTokens: usage.promptTokens || 0,
            completionTokens: usage.completionTokens || 0,
            totalTokens: usage.totalTokens || 0,
            estimated: !!usage.estimated,
            cost: costOf(usage, m), latencyMs: 0, ok: true, error: ''
          }));
        }
        if (!title) return;
        favorite.title = title;
        invoke('updateFavorite', JSON.stringify(favorite));
        try { window.dispatchEvent(new CustomEvent('zj:favorites-changed')); } catch (exception) {}
      },
      onError: function () {}
    });
  }

  function formatCost(value) {
    if (!value) return '¥0';
    if (value < 0.01) return '¥' + value.toFixed(4);
    return '¥' + value.toFixed(2);
  }

  function formatTime(ts) {
    var date = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' '
      + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function formatTokens(value) {
    var n = Number(value || 0);
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function renderMarkdown(text) {
    try {
      var html = marked.parse(text || '', { gfm: true, breaks: true });
      return DOMPurify.sanitize(html);
    } catch (exception) {
      return '<p>' + escapeHtml(text) + '</p>';
    }
  }

  function threadHtml(turns, question, answer, streaming) {
    var html = '';
    (turns || []).forEach(function (turn) {
      if (turn.question) {
        html += '<div class="turn-q">' + escapeHtml(turn.question) + '</div>';
      }
      if (turn.answer) {
        html += '<div class="turn-a">' + renderMarkdown(turn.answer) + '</div>';
      }
    });
    if (question) {
      html += '<div class="turn-q">' + escapeHtml(question) + '</div>';
    }
    var body = answer ? renderMarkdown(answer) : '';
    if (streaming) body += '<span class="caret"></span>';
    html += '<div class="turn-a">' + body + '</div>';
    return html;
  }

  function testConnection(settings, callback) {
    var request = {
      baseUrl: baseUrlOf(settings),
      apiKey: keyOf(settings),
      model: modelOf(settings),
      system: '你是连接测试助手。',
      user: '只回复：OK'
    };
    var buffer = '';
    return chat(request, {
      onDelta: function (piece) { buffer += piece; },
      onDone: function (usage) { callback(null, buffer || 'OK', usage); },
      onError: function (message) { callback(message); }
    });
  }

  /**
   * 备份恢复用的合并：按 id 去重，已有的保留不动，新来的按原顺序追加，
   * 超过上限时从末尾截断。纯函数，可离线单测；备份导出/导入（Bridge）
   * 的历史、收藏、用量都走它。
   */
  function mergeRecords(existing, incoming, cap) {
    var list = (existing || []).slice();
    var seen = {};
    list.forEach(function (item) { if (item && item.id) seen[item.id] = true; });
    (incoming || []).forEach(function (item) {
      if (!item || !item.id || seen[item.id]) return;
      seen[item.id] = true;
      list.push(item);
    });
    var limit = cap > 0 ? cap : list.length;
    return list.slice(0, limit);
  }

  window.ZJCore = {
    invoke: invoke,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getProvider: getProvider,
    keyOf: keyOf,
    modelOf: modelOf,
    baseUrlOf: baseUrlOf,
    modelLabel: modelLabel,
    modelOptionLabel: modelOptionLabel,
    multiplierBadge: multiplierBadge,
    usageMultiplier: usageMultiplier,
    formatUsageMultiplier: formatUsageMultiplier,
    multiplierTone: multiplierTone,
    buildRequest: buildRequest,
    chat: chat,
    cancel: cancel,
    uid: uid,
    readArray: readArray,
    getHistory: function () { return readArray('getHistory'); },
    getFavorites: function () { return readArray('getFavorites'); },
    getUsage: function () { return readArray('getUsage'); },
    addFavorite: addFavorite,
    removeFavorite: function (id) { invoke('removeFavorite', id); },
    record: record,
    mergeRecords: mergeRecords,
    costOf: costOf,
    formatCost: formatCost,
    formatTime: formatTime,
    formatTokens: formatTokens,
    escapeHtml: escapeHtml,
    renderMarkdown: renderMarkdown,
    threadHtml: threadHtml,
    testConnection: testConnection
  };
})();
