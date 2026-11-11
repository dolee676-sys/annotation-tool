/**
 * 首页（window.ZJHome）v2。
 *
 * 一屏只做一件事：回来继续读。只留问候、一句「最近在读」、
 * 一个主要动作（开始阅读）、最近 3 条注解（安静的列表）、
 * 底部一行状态小字（模型 / 划词 / 版本，有新版时才多一句）。
 * 模型面板、用量四格、更新面板、划词与模型两行状态全部砍掉：
 * 用量明细在记录页，模型配置和更新在设置页，顶部已有更新横幅。
 * 只读本机已有数据，不新增联网。
 * 点最近注解进详情、去设置等跨模块动作由 app.js 通过 setUi 交进来，
 * home.js 自己不碰 app.js 的内部状态。
 */
(function () {
  var C = window.ZJCore;

  var ui = {
    switchTab: function () {},
    openDetail: function () {},
    showSettingsGroup: function () {},
    showUsage: function () {},
    toast: function () {}
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function greeting(hour) {
    if (hour >= 5 && hour < 9) return '早上好';
    if (hour >= 9 && hour < 12) return '上午好';
    if (hour >= 12 && hour < 14) return '中午好';
    if (hour >= 14 && hour < 18) return '下午好';
    if (hour >= 18 && hour < 23) return '晚上好';
    return '夜深了';
  }

  function weekdayName(day) {
    return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][day] || '';
  }

  /** 用量汇总（纯函数，可单测）：与记录页 renderUsage 同一套算法。 */
  function summarizeUsage(list, nowMs) {
    var start = new Date(nowMs);
    start.setHours(0, 0, 0, 0);
    var out = {
      todayRequests: 0,
      todayTokens: 0,
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0
    };
    (list || []).forEach(function (record) {
      out.totalRequests++;
      out.totalTokens += record.totalTokens || 0;
      out.totalCost += record.cost || 0;
      if (record.ts >= start.getTime()) {
        out.todayRequests++;
        out.todayTokens += record.totalTokens || 0;
      }
    });
    return out;
  }

  function snippet(text, length) {
    var value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > length ? value.slice(0, length) + '…' : value;
  }

  function dailyLine(history) {
    var latest = history && history[0];
    var text = latest && (latest.text || latest.question || '');
    if (text) return '最近在读：「' + snippet(text, 28) + '」';
    return '选中一段文字，点「注」，就能看到词义和语境。';
  }

  /** 最近注解的一行：徽标 + 标题 + 时间（多轮会标出轮数）。 */
  function recentCard(record) {
    var ask = record.mode === 'ask';
    var title = record.title
      || (record.question || record.text || '').replace(/\s+/g, ' ').trim().slice(0, 30)
      || '注解';
    var turns = record.turns && record.turns.length > 1
      ? '<span class="home-rec-turn">' + record.turns.length + ' 轮</span>' : '';
    return '<article class="rec-card home-rec" data-id="' + C.escapeHtml(record.id) + '">'
      + '<div class="home-rec-top"><span class="badge' + (ask ? ' ask' : '') + '">'
      + (ask ? '提问' : '注解') + '</span>' + turns
      + '<span class="home-rec-time">' + C.escapeHtml(C.formatTime(record.ts)) + '</span></div>'
      + '<div class="rec-title">' + C.escapeHtml(title) + '</div>'
      + '</article>';
  }

  function statCell(value, label) {
    return '<div class="home-stat"><b>' + C.escapeHtml(String(value)) + '</b><span>'
      + C.escapeHtml(label) + '</span></div>';
  }

  /** 底部一行状态：写成一句小字，不占板块。 */
  function statusLine(hasKey, modelLabel, captureOn, update, currentVersion) {
    var parts = [];
    parts.push(hasKey ? '模型 ' + modelLabel + ' 已就绪' : '还没配模型');
    parts.push(captureOn ? '划词已开' : '划词未开');
    if (update && update.available && update.latest) {
      parts.push('发现新版本 ' + update.latest);
    } else if (currentVersion) {
      parts.push('当前 ' + currentVersion + ' 已是最新');
    }
    return parts.join('，') + '。';
  }

  function render() {
    var body = $('#homeBody');
    if (!body) return;
    var now = new Date();
    var settings = C.getSettings();
    var provider = C.getProvider(settings);
    var hasKey = !!C.keyOf(settings);
    var model = C.modelOf(settings);
    var captureOn = false;
    try {
      captureOn = C.invoke('isCaptureMaster') === 'true';
    } catch (ignored) {
    }
    var history = C.getHistory();
    var favorites = C.getFavorites();
    var usage = summarizeUsage(C.getUsage(), now.getTime());
    var update = window.ZJUpdate ? window.ZJUpdate.summary() : null;
    var currentVersion = '';
    try {
      currentVersion = C.invoke('getVersion') || '';
    } catch (ignored) {
    }

    var hasReading = !!(history && history[0] && (history[0].text || history[0].question));
    var recent = history.slice(0, 4);
    var recentHtml = '<section class="home-recent">'
      + '<div class="home-section-head"><h2>最近注解</h2>'
      + (recent.length ? '<button class="home-link" data-action="goto-records">看全部记录</button>' : '')
      + '</div>'
      + (recent.length
        ? '<div class="home-rec-list">' + recent.map(recentCard).join('') + '</div>'
        : '<p class="home-empty">还没有注解。在「阅读」里选中一段文字，点「注解」就会出现在这里。</p>')
      + '</section>';

    var footAction = '';
    if (update && update.hasPackage) {
      footAction = '<button class="home-link" data-action="install-update">安装更新</button>';
    } else if (update && update.available) {
      footAction = '<button class="home-link" data-action="download-update">下载并安装</button>';
    } else {
      footAction = '<button class="home-link" data-action="check-update"'
        + (update && (update.checking || update.downloading) ? ' disabled' : '') + '>'
        + (update && update.checking ? '检查中…' : update && update.downloading ? '下载中…' : '检查更新')
        + '</button>';
    }
    var footSetup = hasKey
      ? ''
      : '<button class="home-link" data-action="goto-model">去设置</button>';

    var footLinks = [footSetup, footAction].filter(function (s) { return s; }).join(' ');
    body.innerHTML = '<div class="home-grid">'
      + '<div class="home-main">'
      + '<p class="home-date">' + (now.getMonth() + 1) + '月' + now.getDate() + '日 '
      + weekdayName(now.getDay()) + '</p>'
      + '<h1>' + greeting(now.getHours()) + '</h1>'
      + (hasReading
        ? '<p class="home-reading">' + C.escapeHtml(dailyLine(history)) + '</p>'
        : '<p class="home-lede">选中一段文字，点「注」，就能看到词义和语境。</p>')
      + '<div class="home-actions">'
      + '<button class="home-primary" data-action="start-read">开始阅读</button>'
      + '</div>'
      + '<div class="home-stats">'
      + statCell(usage.todayRequests, '今日注解')
      + statCell(C.formatTokens(usage.totalTokens), '累计 tokens')
      + statCell(favorites.length, '收藏')
      + '</div>'
      + '</div>'
      + '<div class="home-side">' + recentHtml + '</div>'
      + '</div>'
      + '<p class="home-foot">'
      + C.escapeHtml(statusLine(hasKey, C.modelLabel(model, provider.id), captureOn, update, currentVersion))
      + (footLinks ? ' ' + footLinks : '')
      + '</p>';
  }

  function bind() {
    var body = $('#homeBody');
    if (!body) return;
    body.addEventListener('click', function (event) {
      var card = event.target.closest('.home-rec');
      if (card) {
        var id = card.getAttribute('data-id');
        var list = C.getHistory();
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === id) {
            ui.openDetail(list[i]);
            return;
          }
        }
        return;
      }
      var button = event.target.closest('[data-action]');
      if (!button) return;
      var action = button.getAttribute('data-action');
      if (action === 'start-read') {
        ui.switchTab('read');
        var paste = document.querySelector('#pasteText');
        if (paste) {
          try {
            paste.focus();
          } catch (ignored) {
          }
        }
      } else if (action === 'goto-model') {
        ui.switchTab('settings');
        ui.showSettingsGroup('model');
      } else if (action === 'goto-records') {
        ui.switchTab('records');
      } else if (action === 'check-update' && window.ZJUpdate) {
        window.ZJUpdate.check(false);
        render();
      } else if (action === 'download-update' && window.ZJUpdate) {
        window.ZJUpdate.download();
        render();
      } else if (action === 'install-update' && window.ZJUpdate) {
        var summary = window.ZJUpdate.summary();
        if (summary.hasPackage && window.ZJUpdate.state.uri) {
          window.ZJUpdate.install(window.ZJUpdate.state.uri);
        }
      }
    });
  }

  window.ZJHome = {
    render: render,
    bind: bind,
    greeting: greeting,
    summarizeUsage: summarizeUsage,
    setUi: function (fns) {
      if (fns.switchTab) ui.switchTab = fns.switchTab;
      if (fns.openDetail) ui.openDetail = fns.openDetail;
      if (fns.showSettingsGroup) ui.showSettingsGroup = fns.showSettingsGroup;
      if (fns.showUsage) ui.showUsage = fns.showUsage;
      if (fns.toast) ui.toast = fns.toast;
    }
  };
})();
