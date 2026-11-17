package com.piona.zhujie;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

/**
 * 从 SelectionService 抽出的悬浮注解面板（内嵌 panel.html / capture.html 的 WebView）。
 * 行为未动：卡片宽高按屏占比算、位置优先贴在选区旁边、顶部拖拽条可拖动、
 * 未钉住时点外部关闭、关闭时取消该窗口的 AI 请求并销毁 WebView。
 */
public class OverlayPanel {
    public interface Host {
        void restoreCaptureBubble();

        /** 「划」气泡的位置（整页抓取的面板贴气泡放），没有气泡时可返回 null。 */
        WindowManager.LayoutParams captureParams();
    }

    private final AccessibilityService service;
    private final Handler handler;
    private final WindowManager windowManager;
    private final Host host;

    private WebView panelWeb;
    private FrameLayout panelRoot;
    private WindowManager.LayoutParams panelParams;
    private boolean panelPinned;
    /**
     * 面板内有文字被选中时为 true：这时点外部不关面板，否则点系统选词
     * 菜单的「复制」会先触发 ACTION_OUTSIDE 把面板关掉、选区随之消失。
     * 由 JS 经 OverlayBridge.setSelectionActive 设置（桥接线程写，主线
     * 程读，volatile 保证可见性）。
     */
    private volatile boolean selectionActive;
    /**
     * 面板代数：每次 show() +1。close() 里解绑 bridge 延后到主线程下一轮，
     * 先让 cancelOwner 已 post 的 __aiDone 跑完（finish→record 存历史），
     * 再解绑并销毁 WebView，避免追问历史丢失。
     */
    private int panelGeneration;

    public OverlayPanel(AccessibilityService service, Handler handler,
                        WindowManager windowManager, Host host) {
        this.service = service;
        this.handler = handler;
        this.windowManager = windowManager;
        this.host = host;
    }

    public boolean isOpen() {
        return panelWeb != null || panelRoot != null;
    }

    public void setSelectionActive(boolean active) {
        selectionActive = active;
    }

    /**
     * 钉住只影响「点外部是否关闭」。焦点规则：
     * - 钉住时立即把键盘焦点交还下层应用（面板窗口加 FLAG_NOT_FOCUSABLE），
     *   这样在文档里点光标就能直接打字；
     * - 只有点面板里的提问栏时，才重新让面板可聚焦并弹出键盘；
     * - 点面板外部时再次交还焦点。
     */
    public void setPinned(boolean pinned) {
        panelPinned = pinned;
        if (pinned) {
            releaseInputFocus();
        } else {
            setPanelFocusable(true);
        }
    }

    /** 点提问栏时调用：重新让面板可聚焦，并聚焦输入框、弹出键盘。 */
    public void requestInputFocus() {
        if (!panelPinned || panelWeb == null || panelRoot == null) return;
        setPanelFocusable(true);
        panelRoot.requestFocus();
        panelWeb.requestFocus();
        panelWeb.postDelayed(() -> {
            WebView web = panelWeb;
            if (web == null) return;
            try {
                web.evaluateJavascript(
                        "(function(){var i=document.getElementById('input');if(i){i.focus();}})();",
                        null);
            } catch (Exception ignored) {
            }
            InputMethodManager imm = (InputMethodManager) service.getSystemService(
                    Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT);
            }
        }, 60);
    }

    /**
     * 把键盘焦点交还下层应用：清掉 WebView 输入焦点、收起键盘；钉住时
     * 同时给面板窗口加 FLAG_NOT_FOCUSABLE，让文档真正拿到键盘。
     */
    public void releaseInputFocus() {
        WebView web = panelWeb;
        if (web != null) {
            View focused = web.findFocus();
            if (focused != null) focused.clearFocus();
            web.clearFocus();
            try {
                web.evaluateJavascript(
                        "(function(){var a=document.activeElement;if(a&&a.blur)a.blur();})();",
                        null);
            } catch (Exception ignored) {
            }
            InputMethodManager imm = (InputMethodManager) service.getSystemService(
                    Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                try {
                    imm.hideSoftInputFromWindow(web.getWindowToken(), 0);
                } catch (Exception ignored) {
                }
            }
        }
        if (panelPinned) setPanelFocusable(false);
    }

    private void setPanelFocusable(boolean focusable) {
        FrameLayout root = panelRoot;
        WindowManager.LayoutParams params = panelParams;
        if (root == null || params == null || windowManager == null) return;
        boolean currently = (params.flags & WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE) == 0;
        if (currently == focusable) return;
        if (focusable) {
            params.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        } else {
            params.flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        }
        try {
            windowManager.updateViewLayout(root, params);
        } catch (Exception ignored) {
        }
    }

    public void show(String text, String context, boolean ask, Rect bounds, boolean capture) {
        close();
        panelGeneration++;
        if (windowManager == null) {
            return;
        }
        DisplayMetrics metrics = service.getResources().getDisplayMetrics();
        int screenWidth = metrics.widthPixels;
        int screenHeight = metrics.heightPixels;
        int cardWidth = capture
                ? Math.min(UiUtil.dp(service, 430), Math.max(UiUtil.dp(service, 320), Math.round(screenWidth * 0.44f)))
                : Math.min(UiUtil.dp(service, 460), Math.max(UiUtil.dp(service, 320), Math.round(screenWidth * 0.46f)));
        int cardHeight = Math.min(UiUtil.dp(service, 560),
                Math.max(UiUtil.dp(service, 420), Math.round(screenHeight * 0.64f)));
        int x;
        int y;
        WindowManager.LayoutParams captureParams = host.captureParams();
        if (capture) {
            int bubbleX = captureParams == null
                    ? screenWidth - UiUtil.dp(service, 60) : captureParams.x;
            int bubbleY = captureParams == null
                    ? screenHeight / 2 : captureParams.y;
            if (bubbleX + UiUtil.dp(service, 22) > screenWidth / 2) {
                x = bubbleX - cardWidth - UiUtil.dp(service, 12);
            } else {
                x = bubbleX + UiUtil.dp(service, 52);
            }
            y = bubbleY + UiUtil.dp(service, 22) - cardHeight / 2;
        } else if (bounds != null && bounds.width() > 0) {
            if (bounds.right + cardWidth + UiUtil.dp(service, 16) <= screenWidth) {
                x = bounds.right + UiUtil.dp(service, 12);
            } else {
                x = bounds.left - cardWidth - UiUtil.dp(service, 12);
            }
            y = bounds.centerY() - cardHeight / 2;
        } else {
            x = screenWidth - cardWidth - UiUtil.dp(service, 20);
            y = (screenHeight - cardHeight) / 2;
        }
        x = Math.max(UiUtil.dp(service, 8), Math.min(x, screenWidth - cardWidth - UiUtil.dp(service, 8)));
        y = Math.max(UiUtil.dp(service, 40), Math.min(y, screenHeight - cardHeight - UiUtil.dp(service, 24)));

        panelPinned = false;
        // 每次打开都用全新 WebView（0.1.38 稳定生命周期）。复用同一 WebView
        // reload 在部分机型上会让「点注」后面板不显示/闪退，这里不复用。
        panelWeb = new WebView(service);
        WebSettings settings = panelWeb.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setTextZoom(Math.round(service.getResources().getConfiguration().fontScale * 100));
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        panelWeb.setBackgroundColor(Color.TRANSPARENT);
        panelWeb.setWebViewClient(new SafeWebViewClient(service));
        panelWeb.setOnTouchListener((view, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_OUTSIDE) {
                if (selectionActive) return false;
                releaseInputFocus();
                if (!panelPinned && !selectionActive) {
                    close();
                    return true;
                }
                return false;
            }
            return false;
        });
        panelWeb.addJavascriptInterface(
                new OverlayBridge(service, panelWeb, text, context, ask, this::close,
                        this::move, this::setPinned,
                        this::setSelectionActive,
                        this::requestInputFocus, this::releaseInputFocus),
                "AndroidBridge");
        panelWeb.loadUrl(capture
                ? "file:///android_asset/capture.html"
                : "file:///android_asset/panel.html");

        panelParams = new WindowManager.LayoutParams(
                cardWidth,
                cardHeight,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
        panelParams.gravity = Gravity.TOP | Gravity.START;
        panelParams.x = x;
        panelParams.y = y;
        panelParams.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;

        FrameLayout root = new FrameLayout(service) {
            @Override
            public boolean dispatchTouchEvent(MotionEvent event) {
                if (event.getActionMasked() == MotionEvent.ACTION_OUTSIDE) {
                    if (selectionActive) return false;
                    releaseInputFocus();
                    if (!panelPinned && !selectionActive) {
                        close();
                        return true;
                    }
                    return false;
                }
                return super.dispatchTouchEvent(event);
            }
        };
        root.setBackgroundColor(Color.TRANSPARENT);
        root.addView(panelWeb, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        PanelDragHandle handle = new PanelDragHandle(service);
        int handleWidth = Math.max(UiUtil.dp(service, 110), cardWidth - UiUtil.dp(service, 190));
        root.addView(handle, new FrameLayout.LayoutParams(
                handleWidth, UiUtil.dp(service, 56), Gravity.TOP | Gravity.START));
        handle.setOnTouchListener(new View.OnTouchListener() {
            private float downX;
            private float downY;
            private int startX;
            private int startY;

            @Override
            public boolean onTouch(View view, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = event.getRawX();
                        downY = event.getRawY();
                        startX = panelParams.x;
                        startY = panelParams.y;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        if (panelRoot == null || panelParams == null
                                || windowManager == null) {
                            return true;
                        }
                        DisplayMetrics metrics = service.getResources().getDisplayMetrics();
                        int newX = startX + Math.round(event.getRawX() - downX);
                        int newY = startY + Math.round(event.getRawY() - downY);
                        newX = Math.max(0,
                                Math.min(newX, metrics.widthPixels - panelParams.width));
                        newY = Math.max(0,
                                Math.min(newY, metrics.heightPixels - panelParams.height));
                        panelParams.x = newX;
                        panelParams.y = newY;
                        try {
                            windowManager.updateViewLayout(panelRoot, panelParams);
                        } catch (Exception ignored) {
                        }
                        return true;
                    default:
                        return true;
                }
            }
        });
        panelRoot = root;
        try {
            windowManager.addView(root, panelParams);
        } catch (Exception exception) {
            close();
        }
    }

    public void close() {
        WebView web = panelWeb;
        AiClient.cancelOwner(web);
        FrameLayout root = panelRoot;
        panelRoot = null;
        panelWeb = null;
        panelPinned = false;
        selectionActive = false;
        if (root != null) {
            if (windowManager != null) {
                try {
                    windowManager.removeView(root);
                } catch (Exception ignored) {
                }
            }
        } else if (web != null && windowManager != null) {
            try {
                windowManager.removeView(web);
            } catch (Exception ignored) {
            }
        }
        if (web != null) {
            // 关键次序：cancelOwner 只是把 __aiDone 回调 post 到主线程，
            // 它跑起来才会调 finish() → C.record() 存历史。这里同步
            // removeJavascriptInterface 会让 record() 时 bridge 已摘、历史丢失。
            // 所以解绑+销毁都延后到主线程下一轮，排在已 post 的 __aiDone 之后。
            final WebView closingWeb = web;
            try {
                new Handler(Looper.getMainLooper()).post(() -> {
                    try {
                        closingWeb.removeJavascriptInterface("AndroidBridge");
                    } catch (Exception ignored) {
                    }
                    try {
                        closingWeb.stopLoading();
                    } catch (Exception ignored) {
                    }
                    try {
                        closingWeb.destroy();
                    } catch (Exception ignored) {
                    }
                });
                web.stopLoading();
            } catch (Exception ignored) {
            }
        }
        host.restoreCaptureBubble();
    }

    /** 服务销毁时调用。 */
    public void destroy() {
        close();
    }

    public void move(int dx, int dy) {
        View target = panelRoot != null ? panelRoot : panelWeb;
        if (target == null || panelParams == null || windowManager == null) {
            return;
        }
        DisplayMetrics metrics = service.getResources().getDisplayMetrics();
        int x = panelParams.x + dx;
        int y = panelParams.y + dy;
        x = Math.max(0, Math.min(x, metrics.widthPixels - panelParams.width));
        y = Math.max(0, Math.min(y, metrics.heightPixels - panelParams.height));
        panelParams.x = x;
        panelParams.y = y;
        try {
            windowManager.updateViewLayout(target, panelParams);
        } catch (Exception ignored) {
        }
    }
}
