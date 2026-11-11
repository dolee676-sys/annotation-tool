package com.piona.zhujie;

import android.accessibilityservice.AccessibilityService;
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
     * 面板代数：每次 show() +1。close() 里解绑 bridge 改为延后执行
     * （见 close() 注释），代数用来判断延后任务跑起来时是不是已经有
     * 新面板复用了同一个 WebView——是就不动新 bridge。
     */
    private int panelGeneration;
    /**
     * 复用的面板 WebView：原来每次打开都 new WebView + 加载页面、关闭就
     * destroy，下次打开又要重付 WebView 创建 + 页面解析的固定开销，
     * 点「注」到面板出来要等一截。现在关面板时只 detach、不销毁，
     * 下次打开复用它，只 reload 一次页面（reload 会重跑 JS 初始化，
     * 旧回答、旧状态不会漏到新面板里）。服务销毁时由 destroy() 真销毁。
     */
    private WebView cachedWeb;

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

    public void show(String text, boolean ask, Rect bounds, boolean capture) {
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
        panelWeb = cachedWeb;
        cachedWeb = null;
        if (panelWeb == null) {
            panelWeb = new WebView(service);
        }
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
                if (!panelPinned && !selectionActive) {
                    close();
                    return true;
                }
                return false;
            }
            return false;
        });
        panelWeb.addJavascriptInterface(
                new OverlayBridge(service, panelWeb, text, ask, this::close,
                        this::move, pinned -> panelPinned = pinned,
                        this::setSelectionActive),
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
        // 键盘焦点：原来面板打开后 WebView 从没主动要过焦点，实体键盘
        // 的按键进不到面板里——Shift+方向键选不了文字、Ctrl+C 也没选区
        // 可拷。窗口本身是可聚焦的（没加 FLAG_NOT_FOCUSABLE），这里让
        // WebView 打开就拿焦点，硬件键盘事件才能走 WebView 的原生处理。
        try {
            panelWeb.setFocusable(true);
            panelWeb.setFocusableInTouchMode(true);
            panelWeb.requestFocus();
        } catch (Exception ignored) {
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
            // 它跑起来才会调 finish() → C.record() 存历史。原来这里同
            // 步就 removeJavascriptInterface，等 __aiDone 落下来时
            // window.AndroidBridge 已经没了，record() 掉进浏览器预览用
            // 的 Mock、写进面板 WebView 自己的 localStorage，主界面
            // （读 SharedPreferences）永远看不到——点外部关面板时
            // 流式没跑完的追问就是这么丢的（点右上角 × 反而能存，因
            // 为 JS 里先 C.cancel、回调先排队）。所以解绑延后到主线
            // 程下一轮、且排在已 post 的 __aiDone 之后；代数 guard 保
            // 证这期间若 show() 复用了同一个 WebView，不会误删新 bridge。
            final WebView closingWeb = web;
            final int closingGeneration = panelGeneration;
            try {
                new Handler(Looper.getMainLooper()).post(() -> {
                    if (closingGeneration != panelGeneration) {
                        return;
                    }
                    try {
                        closingWeb.removeJavascriptInterface("AndroidBridge");
                    } catch (Exception ignored) {
                    }
                });
                web.stopLoading();
            } catch (Exception ignored) {
            }
            // 只 detach、不 destroy：留给下次 show() 复用。
            // 旧 bridge 已解绑，下次 show 会绑新的（新文字/新模式），
            // 再 loadUrl 一次，JS 状态是全新的。
            cachedWeb = web;
        }
        host.restoreCaptureBubble();
    }

    /** 服务销毁时调用：真正销毁复用的 WebView，释放渲染进程。 */
    public void destroy() {
        close();
        WebView cached = cachedWeb;
        cachedWeb = null;
        if (cached != null) {
            try {
                cached.removeJavascriptInterface("AndroidBridge");
                cached.stopLoading();
                cached.destroy();
            } catch (Exception ignored) {
            }
        }
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
