/**
 * 应用内更新状态机（从 app.js 抽出）。
 *
 * Java 侧（Updater.java）回调的全局函数名不能改：
 * __updateResult / __updateProgress / __updateDownloaded /
 * __updateNeedPermission / __updateInstalling / __updateError。
 *
 * 相对旧版 app.js 内联实现修掉的问题：
 * - U5：检查回调丢失会让 checking 永远为真、按钮永久卡住。
 *   现在检查有 20 秒看门狗，超时自动复位并提示。
 * - U2：下载看门狗超时只改 UI、不停 Java 下载，下载完还会突然
 *   弹出安装。现在超时会调 cancelUpdateDownload 真正取消下载。
 * - 下载用 6 参入口，把清单里的 size 传给 Java 做长度校验
 *   （旧 5 参入口传的是 0，不校验长度）。
 * - 检查失败时清掉过期 available/data（已有下载好的包时不清，
 *   免得把「安装更新」按钮弄丢）。
 */
(function () {
  var C = window.ZJCore;
  var OFFICIAL_UPDATE_URL = 'https://api.github.com/repos/dolee676-sys/annotation-tool/contents/android-release/latest.json';
  var CHECK_TIMEOUT_MS = 20000;
  var DOWNLOAD_TIMEOUT_MS = 30000;
  var DOWNLOAD_TICK_MS = 4000;

  var state = {
    checking: false,
    downloading: false,
    available: false,
    data: null,
    uri: null,
    /** 已下载安装包对应的 versionCode：检查出更新的版本时，旧包必须作废。 */
    uriVersionCode: null
  };
  var handlers = new Map();
  var checkTimer = null;
  var downloadTimer = null;
  var downloadId = null;
  var lastProgressAt = 0;
  var toastFn = function () {};
  var switchTabFn = function () {};
  var changeFn = function () {};

  /** 检查/下载/安装任一状态变化后通知首页重绘（只在首页可见时重绘，由调用方判断）。 */
  function notifyChange() {
    try {
      changeFn();
    } catch (ignored) {
    }
  }

  function $(selector) {
    return document.querySelector(selector);
  }

  function setStatus(text) {
    var element = $('#updateStatus');
    if (element) element.textContent = text || '';
  }

  function downloadButton() {
    return $('#downloadUpdate');
  }

  window.__updateResult = function (id, data) {
    var handler = handlers.get(id);
    if (!handler) return;
    handlers.delete(id);
    if (handler.onResult) handler.onResult(data || {});
  };
  window.__updateProgress = function (id, percent) {
    var handler = handlers.get(id);
    if (handler && handler.onProgress) handler.onProgress(percent);
  };
  window.__updateDownloaded = function (id, uri, versionName, versionCode) {
    var handler = handlers.get(id);
    if (!handler) return;
    handlers.delete(id);
    if (handler.onDownloaded) handler.onDownloaded(uri, versionName, versionCode);
  };
  window.__updateNeedPermission = function (id) {
    var handler = handlers.get(id);
    if (!handler) return;
    handlers.delete(id);
    if (handler.onNeedPermission) handler.onNeedPermission();
  };
  window.__updateInstalling = function (id, detail) {
    var handler = handlers.get(id);
    if (!handler) return;
    handlers.delete(id);
    if (handler.onInstalling) handler.onInstalling(detail);
  };
  window.__updateError = function (id, message) {
    var handler = handlers.get(id);
    if (!handler) return;
    handlers.delete(id);
    if (handler.onError) handler.onError(message || '更新失败');
  };

  function clearCheckTimer() {
    if (checkTimer) {
      clearTimeout(checkTimer);
      checkTimer = null;
    }
  }

  function clearDownloadTimer() {
    if (downloadTimer) {
      clearInterval(downloadTimer);
      downloadTimer = null;
    }
  }

  /** 手动下载地址：有新版本时指向对应 tag，没有时指向 Releases 列表。 */
  function manualUrl() {
    var ver = state.data && state.data.latestVersion;
    return ver
      ? 'https://github.com/dolee676-sys/annotation-tool/releases/tag/android-v' + ver
      : 'https://github.com/dolee676-sys/annotation-tool/releases';
  }

  function check(silent) {
    if (state.checking) return;
    state.checking = true;
    setStatus('检查中…');
    var button = downloadButton();
    if (button) button.hidden = true;
    var id = C.uid('upd');
    handlers.set(id, {
      onResult: function (data) {
        clearCheckTimer();
        state.checking = false;
        state.downloading = false;
        if (button) button.disabled = false;
        state.data = data;
        state.available = !!data.available;
        if (state.uri && String(data.versionCode || '') !== String(state.uriVersionCode || '')) {
          state.uri = null;
          state.uriVersionCode = null;
        }
        var latest = (data.latestVersion || '—')
          + ' (' + (data.versionCode || '?') + ')';
        if (data.available) {
          var text = '发现新版本 ' + latest + '，当前 '
            + (data.currentVersion || '—')
            + (data.notes ? '：' + data.notes : '');
          setStatus(text);
          if (button) {
            button.hidden = false;
            button.textContent = '下载并安装';
          }
          var bannerText = $('#updateBannerText');
          if (bannerText) bannerText.textContent = '发现新版本 ' + latest;
          var banner = $('#updateBanner');
          if (banner) banner.hidden = false;
          if (!silent) toastFn('发现新版本 ' + latest);
        notifyChange();
        } else {
          state.available = false;
          setStatus('已是最新：当前 ' + (data.currentVersion || '—')
            + ' · 最新 ' + latest);
          var bannerEl = $('#updateBanner');
          if (bannerEl) bannerEl.hidden = true;
          if (!silent) {
            toastFn('已是最新：' + (data.currentVersion || '') + ' / ' + latest);
          }
        notifyChange();
        }
      },
      onError: function (message) {
        clearCheckTimer();
        state.checking = false;
        state.downloading = false;
        if (button) button.disabled = false;
        // 检查失败不碰 available/data/uri：上次查到的更新和下好的包还能继续用。
        setStatus('检查失败：' + message);
        notifyChange();
        if (!silent) toastFn('检查失败：' + message);
      }
    });
    // U5：回调丢失时 20 秒后自动复位，不让「检查更新」永久卡住。
    checkTimer = setTimeout(function () {
      if (!state.checking) return;
      handlers.delete(id);
      checkTimer = null;
      state.checking = false;
      state.downloading = false;
      if (button) button.disabled = false;
      setStatus('检查超时（网络不稳），请重试或点「手动下载」。');
        notifyChange();
      if (!silent) toastFn('检查超时，请重试。');
    }, CHECK_TIMEOUT_MS);
    C.invoke('checkUpdate', OFFICIAL_UPDATE_URL, id);
  }

  function download() {
    var data = state.data;
    if (!data || !data.available) {
      check(false);
      return;
    }
    if (!data.url || !data.sha256) {
      toastFn('更新清单不完整，缺少下载地址或校验值。');
      return;
    }
    if (state.downloading) return;
    state.downloading = true;
    var button = downloadButton();
    if (button) {
      button.disabled = true;
      button.textContent = '下载中…';
    }
    setStatus('准备下载…');
    var id = C.uid('upd');
    downloadId = id;
    lastProgressAt = Date.now();
    clearDownloadTimer();
    downloadTimer = setInterval(function () {
      if (!state.downloading) {
        clearDownloadTimer();
        return;
      }
      if (Date.now() - lastProgressAt > DOWNLOAD_TIMEOUT_MS) {
        // U2：超时不只改 UI，还要让 Java 侧真正停下下载，
        // 否则下载完还会突然弹出安装。
        clearDownloadTimer();
        downloadId = null;
        handlers.delete(id);
        state.downloading = false;
        try {
          C.invoke('cancelUpdateDownload', id);
        } catch (ignored) {
        }
        if (button) {
          button.disabled = false;
          button.textContent = '重试下载';
        }
        setStatus('下载超时（网络不稳）。可点「手动下载」用浏览器下载。');
        toastFn('下载超时，可点「手动下载」。');
      }
    }, DOWNLOAD_TICK_MS);
    handlers.set(id, {
      onProgress: function (percent) {
        lastProgressAt = Date.now();
        setStatus('下载中 ' + percent + '%');
      },
      onDownloaded: function (uri, versionName, versionCode) {
        clearDownloadTimer();
        downloadId = null;
        state.downloading = false;
        state.uri = uri;
        state.uriVersionCode = versionCode;
        if (button) {
          button.disabled = false;
          button.textContent = '安装更新';
        }
        setStatus('下载完成 ' + (versionName || '') + ' ('
          + (versionCode || '') + ')，正在打开安装界面…');
        notifyChange();
        install(uri);
      },
      onError: function (message) {
        clearDownloadTimer();
        downloadId = null;
        state.downloading = false;
        if (button) {
          button.disabled = false;
          button.textContent = '重试下载';
        }
        setStatus('下载失败：' + message + '（可点「手动下载」）');
        notifyChange();
        toastFn('下载失败：' + message);
      }
    });
    // 6 参入口：把清单里的 size 传过去做长度校验。
    C.invoke('downloadUpdate', data.url, data.sha256,
      String(data.versionCode || ''), data.latestVersion || '', id,
      String(data.size || 0));
  }

  function install(uri) {
    if (!uri) return;
    var id = C.uid('upd');
    handlers.set(id, {
      onNeedPermission: function () {
        var button = downloadButton();
        if (button) {
          button.hidden = false;
          button.disabled = false;
          button.textContent = '安装更新';
        }
        setStatus('请允许「注解」安装未知应用，然后点“安装更新”。');
        notifyChange();
        toastFn('请先允许安装未知应用。');
      },
      onInstalling: function (detail) {
        setStatus((detail ? detail + '；' : '') + '已打开系统安装界面，请点“安装”。');
        notifyChange();
      },
      onError: function (message) {
        setStatus('无法安装：' + message);
        notifyChange();
        toastFn('无法安装：' + message);
      }
    });
    C.invoke('installUpdate', uri, id);
  }

  /** 设置页每次渲染时恢复下载按钮的状态（原来在 renderSettings 里）。 */
  function syncView() {
    var button = downloadButton();
    if (!button) return;
    if (state.uri) {
      button.hidden = false;
      button.disabled = false;
      button.textContent = '安装更新';
      setStatus('下载完成，点“安装更新”。');
    } else if (state.available && state.data) {
      button.hidden = false;
      button.disabled = false;
      button.textContent = '下载并安装';
      setStatus('发现新版本 ' + (state.data.latestVersion || ''));
    } else if (!state.checking && !state.downloading) {
      button.hidden = true;
      setStatus('');
    }
  }

  /** 首页卡片用：当前版本 / 最新版本 / 是否有更新 / 状态文案。 */
  function summary() {
    var data = state.data || {};
    return {
      current: data.currentVersion || '',
      latest: data.latestVersion || '',
      latestCode: data.versionCode || '',
      available: state.available,
      checking: state.checking,
      downloading: state.downloading,
      hasPackage: !!state.uri,
      statusText: (function () {
        var el = $('#updateStatus');
        return el ? el.textContent : '';
      })()
    };
  }

  function bind() {
    var checkBtn = $('#checkUpdate');
    if (checkBtn) {
      checkBtn.addEventListener('click', function () { check(false); });
    }
    var manualBtn = $('#manualUpdate');
    if (manualBtn) {
      manualBtn.addEventListener('click', function () {
        C.invoke('openUrl', manualUrl());
      });
    }
    var downloadBtn = downloadButton();
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function () {
        if (state.uri) install(state.uri);
        else download();
      });
    }
    var autoBox = $('#autoUpdate');
    if (autoBox) {
      autoBox.addEventListener('change', function () {
        var settings = C.getSettings();
        settings.autoCheckUpdates = this.checked;
        C.saveSettings(settings);
      });
    }
    var bannerClose = $('#updateBannerClose');
    if (bannerClose) {
      bannerClose.addEventListener('click', function () {
        var banner = $('#updateBanner');
        if (banner) banner.hidden = true;
      });
    }
    var bannerBtn = $('#updateBannerBtn');
    if (bannerBtn) {
      bannerBtn.addEventListener('click', function () {
        switchTabFn('settings');
        var card = $('#updateCard');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (state.uri) install(state.uri);
        else if (state.available) download();
        else check(false);
      });
    }
  }

  window.ZJUpdate = {
    OFFICIAL_UPDATE_URL: OFFICIAL_UPDATE_URL,
    state: state,
    bind: bind,
    check: check,
    download: download,
    install: install,
    syncView: syncView,
    summary: summary,
    manualUrl: manualUrl,
    /** 只给 node 单测用：把 20 秒/30 秒看门狗改短，不改任何逻辑。 */
    _setTestTimeouts: function (checkMs, downloadMs, tickMs) {
      CHECK_TIMEOUT_MS = checkMs;
      DOWNLOAD_TIMEOUT_MS = downloadMs;
      if (tickMs) DOWNLOAD_TICK_MS = tickMs;
    },
    setStatus: setStatus,
    /** app.js 把自己的 toast / switchTab 交过来，避免 update.js 直接碰 app 的内部函数。 */
    setUi: function (fns) {
      if (fns.toast) toastFn = fns.toast;
      if (fns.switchTab) switchTabFn = fns.switchTab;
      if (fns.onUpdateChange) changeFn = fns.onUpdateChange;
    }
  };
})();
