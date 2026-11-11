/**
 * 首页（window.ZJHome）。
 *
 * 只读本机已有数据，不新增联网：问候 + 今日一句（最新一条历史，
 * 没有历史时用固定文案）、快捷入口、最近注解、模型状态、用量小结、
 * 更新状态（复用 ZJUpdate，不另写一套）。
 * 点最近注解进详情、去用量等跨模块动作由 app.js 通过 setUi 交进来，
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

  function recentCard(record) {
    var ask = record.mode === 'ask';
    var title = record.title
      || (record.question || record.text || '').replace(/\s+/g, ' ').trim().slice(0, 30)
      || '注解';
    return '<article class="rec-card home-rec" data-id="' + C.escapeHtml(record.id) + '">'
      + '<div class="rec-top"><span class="badge' + (ask ? ' ask' : '') + '">'
      + (ask ? '提问' : '注解') + '</span><span>' + C.escapeHtml(C.formatTime(record.ts)) + '</span></div>'
      + '<div class="rec-title">' + C.escapeHtml(title) + '</div>'
      + '<div class="rec-foot"><span>' + C.formatTokens(record.totalTokens) + ' tokens</span>'
      + '<span>' + C.formatCost(record.cost) + '</span></div>'
      + '</article>';
  }

  function updateCardHtml(summary, currentVersion) {
    var line = summary.available && summary.latest
      ? '发现新版本 ' + C.escapeHtml(summary.latest)
        + (summary.latestCode ? ' (' + C.escapeHtml(summary.latestCode) + ')' : '')
      : summary.statusText || ('当前 ' + (currentVersion || '—') + '，已是最新');
    if (!summary.available && !summary.hasPackage) {
      // 无新版时不占一张卡，只留一行字 + 检查更新。
      return '<p class="home-update-quiet">' + line
        + ' <button class="home-link" data-action="check-update"'
        + (summary.checking || summary.downloading ? ' disabled' : '') + '>'
        + (summary.checking ? '检查中…' : summary.downloading ? '下载中…' : '检查更新')
        + '</button></p>';
    }
    var action = '';
    if (summary.hasPackage) {
      action = '<button class="btn primary" data-action="install-update">安装更新</button>';
    } else if (summary.available) {
      action = '<button class="btn primary" data-action="download-update">下载并安装</button>';
    } else {
      action = '<button class="btn" data-action="check-update"'
        + (summary.checking || summary.downloading ? ' disabled' : '') + '>'
        + (summary.checking ? '检查中…' : summary.downloading ? '下载中…' : '检查更新')
        + '</button>';
    }
    return '<section class="home-panel home-update"><h2>更新</h2>'
      + '<p class="home-line">当前版本 <b>' + C.escapeHtml(currentVersion || '—') + '</b></p>'
      + '<p class="home-line">' + line + '</p>'
      + '<div class="row">' + action
      + '<button class="btn ghost small" data-action="manual-update">手动下载</button></div>'
      + '</section>';
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
    var usage = summarizeUsage(C.getUsage(), now.getTime());
    var update = window.ZJUpdate ? window.ZJUpdate.summary() : null;
    var currentVersion = '';
    try {
      currentVersion = C.invoke('getVersion') || '';
    } catch (ignored) {
    }

    var modelLine = hasKey
      ? C.escapeHtml(provider.name) + ' · ' + C.escapeHtml(C.modelLabel(model, provider.id))
      : '还没配 Key，先去设置里选模型、粘贴 Key';
    var modelAction = hasKey
      ? '<button class="btn ghost small" data-action="goto-model">换模型</button>'
      : '<button class="btn primary" data-action="goto-model">去配模型</button>';

    var hasReading = !!(history && history[0] && (history[0].text || history[0].question));
    var recent = history.slice(0, 5);
    var recentHtml = recent.length
      ? '<div class="home-rec-list">' + recent.map(recentCard).join('') + '</div>'
      : '<div class="home-empty">还没有注解。去「阅读」粘贴一段文字，选中后点「注解」，'
        + '第一条就会出现在这里。<div class="row" style="margin-top:14px">'
        + '<button class="btn primary" data-action="start-read">开始阅读</button></div></div>';

    body.innerHTML = '<div class="home-hero">'
      + '<p class="home-date">' + (now.getMonth() + 1) + '月' + now.getDate() + '日 '
      + weekdayName(now.getDay()) + '</p>'
      + '<h1>' + greeting(now.getHours()) + '</h1>'
      + (hasReading
        ? '<p class="home-reading">' + C.escapeHtml(dailyLine(history)) + '</p>'
        : '<p class="home-lede">' + C.escapeHtml(dailyLine(history)) + '</p>')
      + '</div>'
      + '<div class="home-actions">'
      + '<button class="home-primary" data-action="start-read"><b>开始阅读</b><span>粘贴文字，选中注解</span></button>'
      + '<button class="home-status-row" data-action="goto-capture"><span class="home-dot' + (captureOn ? ' on' : '') + '"></span><span class="home-status-text"><b>划词 ' + (captureOn ? '已开' : '未开') + '</b><span>'
      + (captureOn ? '在其他应用里选中就有「注 / 问」' : '点我去设置里开启悬浮取词') + '</span></span></button>'
      + '<button class="home-status-row" data-action="goto-model"><span class="home-dot' + (hasKey ? ' on' : '') + '"></span><span class="home-status-text"><b>' + (hasKey ? '模型已就绪' : '去配模型') + '</b><span>'
      + C.escapeHtml(hasKey ? C.modelLabel(model, provider.id) : '选模型、粘贴 Key') + '</span></span></button>'
      + '</div>'
      + '<div class="home-grid">'
      + '<section class="home-recent"><div class="home-section-head"><h2>最近注解</h2>'
      + '<button class="home-link" data-action="goto-records">看全部记录</button></div>'
      + recentHtml + '</section>'
      + '<div class="home-side">'
      + '<section class="home-panel"><h2>模型</h2>'
      + '<p class="home-line">' + modelLine + '</p>'
      + '<p class="home-line muted">云端模型 · Key 只存本机，不会明文显示</p>'
      + '<div class="row">' + modelAction + '</div>'
      + '<div class="home-divider"></div>'
      + '<h2>用量</h2>'
      + '<div class="stats home-stats">'
      + '<div class="stat"><b>' + usage.todayRequests + '</b><span>今天请求</span></div>'
      + '<div class="stat"><b>' + C.formatTokens(usage.todayTokens) + '</b><span>今天 tokens</span></div>'
      + '<div class="stat"><b>' + C.formatTokens(usage.totalTokens) + '</b><span>累计 tokens</span></div>'
      + '<div class="stat"><b>' + C.formatCost(usage.totalCost) + '</b><span>累计估算花费</span></div>'
      + '</div>'
      + (usage.totalRequests
          ? '<div class="row"><button class="btn ghost small" data-action="goto-usage">看用量明细</button></div>'
          : '<p class="home-line muted">回答一次后，这里会统计 token 和估算花费。</p>')
      + '</section>'
      + (update ? updateCardHtml(update, currentVersion) : '')
      + '</div></div>';
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
      } else if (action === 'goto-capture') {
        ui.switchTab('settings');
        ui.showSettingsGroup('capture');
      } else if (action === 'goto-records') {
        ui.switchTab('records');
      } else if (action === 'goto-usage') {
        ui.showUsage();
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
      } else if (action === 'manual-update' && window.ZJUpdate) {
        C.invoke('openUrl', window.ZJUpdate.manualUrl());
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
