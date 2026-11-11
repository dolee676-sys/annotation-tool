package com.piona.zhujie;

import android.accessibilityservice.AccessibilityService;
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 从 SelectionService 抽出的屏幕边缘「划」气泡 + 长按菜单。
 * 行为未动：拖动、600ms 长按出菜单（整页抓取 / 读剪贴板 / 关闭划）、
 * 点按进划选模式；气泡 44dp，菜单项触控高度约 12+9+9+文字 ≈ 42dp。
 */
public class CaptureBubble {
    public interface Host {
        void enterSelectionMode();

        void captureActiveWindow();

        void readClipboardFromMenu();

        void hideChip();

        void removeSelectionLayer();

        /** 气泡被关闭时：OCR 代次 +1（作废旧回调），由服务执行。 */
        void onBubbleDisabled();
    }

    private final AccessibilityService service;
    private final Handler handler;
    private final WindowManager windowManager;
    private final Host host;

    private TextView captureBubble;
    private WindowManager.LayoutParams captureParams;
    private LinearLayout captureMenu;
    private WindowManager.LayoutParams captureMenuParams;
    private boolean captureBubbleDisabled;
    private boolean longPressTriggered;
    private float bubbleDownX;
    private float bubbleDownY;
    private int bubbleStartX;
    private int bubbleStartY;
    private boolean bubbleMoved;
    private final Runnable longPressRunnable = this::showCaptureMenu;

    public CaptureBubble(AccessibilityService service, Handler handler,
                         WindowManager windowManager, Host host) {
        this.service = service;
        this.handler = handler;
        this.windowManager = windowManager;
        this.host = host;
    }

    public boolean isDisabled() {
        return captureBubbleDisabled;
    }

    public WindowManager.LayoutParams params() {
        return captureParams;
    }

    public void create() {
        if (windowManager == null) {
            return;
        }
        captureBubble = new TextView(service);
        captureBubble.setText("划");
        captureBubble.setTextColor(0xFFF6F2EA);
        captureBubble.setTextSize(14);
        captureBubble.setGravity(Gravity.CENTER);
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xFF9A4B16);
        background.setCornerRadius(UiUtil.dp(service, 22));
        captureBubble.setBackground(background);
        captureBubble.setElevation(UiUtil.dp(service, 6));
        captureBubble.setOnTouchListener((view, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    hideMenu();
                    bubbleDownX = event.getRawX();
                    bubbleDownY = event.getRawY();
                    bubbleStartX = captureParams.x;
                    bubbleStartY = captureParams.y;
                    bubbleMoved = false;
                    longPressTriggered = false;
                    handler.removeCallbacks(longPressRunnable);
                    handler.postDelayed(longPressRunnable, 600);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    int dx = Math.round(event.getRawX() - bubbleDownX);
                    int dy = Math.round(event.getRawY() - bubbleDownY);
                    if (Math.abs(dx) > UiUtil.dp(service, 6)
                            || Math.abs(dy) > UiUtil.dp(service, 6)) {
                        bubbleMoved = true;
                        handler.removeCallbacks(longPressRunnable);
                    }
                    DisplayMetrics metrics = service.getResources().getDisplayMetrics();
                    captureParams.x = Math.max(0, Math.min(
                            bubbleStartX + dx, metrics.widthPixels - UiUtil.dp(service, 48)));
                    captureParams.y = Math.max(0, Math.min(
                            bubbleStartY + dy, metrics.heightPixels - UiUtil.dp(service, 48)));
                    try {
                        windowManager.updateViewLayout(captureBubble, captureParams);
                    } catch (Exception ignored) {
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    handler.removeCallbacks(longPressRunnable);
                    if (!bubbleMoved && !longPressTriggered) {
                        host.enterSelectionMode();
                    }
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    handler.removeCallbacks(longPressRunnable);
                    return true;
                default:
                    return false;
            }
        });

        captureParams = new WindowManager.LayoutParams(
                UiUtil.dp(service, 44),
                UiUtil.dp(service, 44),
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        captureParams.gravity = Gravity.TOP | Gravity.START;
        DisplayMetrics metrics = service.getResources().getDisplayMetrics();
        captureParams.x = metrics.widthPixels - UiUtil.dp(service, 60);
        captureParams.y = metrics.heightPixels / 2;
        try {
            windowManager.addView(captureBubble, captureParams);
        } catch (Exception exception) {
            captureBubble = null;
        }
    }

    /** 供 App 内按钮恢复「划」气泡；服务未连接时由调用方先判断。 */
    public void enable() {
        captureBubbleDisabled = false;
        if (captureBubble == null) {
            create();
        } else {
            captureBubble.setVisibility(View.VISIBLE);
        }
    }

    /** 取词总开关 / OCR 代次变化时的恢复逻辑：关了就藏气泡，开了就显示。 */
    public void restore(boolean captureOff) {
        if (captureOff) {
            if (captureBubble != null) {
                captureBubble.setVisibility(View.GONE);
            }
            return;
        }
        if (captureBubble != null && !captureBubbleDisabled) {
            captureBubble.setVisibility(View.VISIBLE);
        }
    }

    public void setVisible(boolean visible) {
        if (captureBubble != null) {
            captureBubble.setVisibility(visible ? View.VISIBLE : View.GONE);
        }
    }

    /**
     * 看门狗自愈：气泡丢了（窗口被意外移除、某条隐藏路径漏恢复）就找
     * 回来。用户亲手在长按菜单里点了“关闭划”的不复活；窗口还在、只
     * 是被藏起来了的，改回可见即可。
     */
    public void ensureVisible() {
        if (captureBubbleDisabled) {
            return;
        }
        if (captureBubble == null) {
            create();
            return;
        }
        if (captureBubble.getParent() == null
                && windowManager != null && captureParams != null) {
            try {
                windowManager.addView(captureBubble, captureParams);
            } catch (Exception ignored) {
                captureBubble = null;
                return;
            }
        }
        if (captureBubble.getVisibility() != View.VISIBLE) {
            captureBubble.setVisibility(View.VISIBLE);
        }
    }

    public void updateForPackage(CharSequence packageName) {
        if (captureBubble == null || captureBubbleDisabled) {
            return;
        }
        boolean own = packageName != null
                && service.getPackageName().contentEquals(packageName);
        captureBubble.setVisibility(own ? View.GONE : View.VISIBLE);
    }

    public void onConfigurationChanged(Configuration newConfig) {
        if (captureParams != null) {
            DisplayMetrics metrics = service.getResources().getDisplayMetrics();
            captureParams.x = Math.max(0, metrics.widthPixels - UiUtil.dp(service, 60));
            captureParams.y = metrics.heightPixels / 2;
            if (captureBubble != null && captureBubble.getParent() != null
                    && windowManager != null) {
                try {
                    windowManager.updateViewLayout(captureBubble, captureParams);
                } catch (Exception ignored) {
                }
            }
        }
        hideMenu();
    }

    public void remove() {
        handler.removeCallbacks(longPressRunnable);
        hideMenu();
        if (captureBubble != null && captureBubble.getParent() != null
                && windowManager != null) {
            try {
                windowManager.removeView(captureBubble);
            } catch (Exception ignored) {
            }
        }
        captureBubble = null;
    }

    private void showCaptureMenu() {
        longPressTriggered = true;
        if (captureBubble == null || windowManager == null) {
            return;
        }
        if (captureMenu == null) {
            captureMenu = new LinearLayout(service);
            captureMenu.setOrientation(LinearLayout.VERTICAL);
            captureMenu.setPadding(UiUtil.dp(service, 4), UiUtil.dp(service, 4),
                    UiUtil.dp(service, 4), UiUtil.dp(service, 4));
            GradientDrawable background = new GradientDrawable();
            background.setColor(0xF22A2723);
            background.setCornerRadius(UiUtil.dp(service, 12));
            captureMenu.setBackground(background);
            captureMenu.setElevation(UiUtil.dp(service, 6));
            captureMenu.addView(makeMenuItem("整页抓取", 0xFFF6F2EA,
                    view -> {
                        hideMenu();
                        host.captureActiveWindow();
                    }));
            captureMenu.addView(makeMenuItem("读剪贴板", 0xFFF6F2EA,
                    view -> host.readClipboardFromMenu()));
            captureMenu.addView(makeMenuItem("关闭划", 0xFFFFB4A8,
                    view -> disableBubble()));
            captureMenuParams = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
            captureMenuParams.gravity = Gravity.TOP | Gravity.START;
        }
        captureMenu.measure(View.MeasureSpec.UNSPECIFIED,
                View.MeasureSpec.UNSPECIFIED);
        int width = captureMenu.getMeasuredWidth();
        int height = captureMenu.getMeasuredHeight();
        int x = captureParams.x - width - UiUtil.dp(service, 8);
        if (x < UiUtil.dp(service, 8)) {
            x = captureParams.x + UiUtil.dp(service, 52);
        }
        captureMenuParams.x = x;
        captureMenuParams.y = Math.max(0, captureParams.y - height / 2 + UiUtil.dp(service, 22));
        if (captureMenu.getParent() == null) {
            try {
                windowManager.addView(captureMenu, captureMenuParams);
            } catch (Exception ignored) {
            }
        }
    }

    private TextView makeMenuItem(String label, int color, View.OnClickListener listener) {
        TextView item = new TextView(service);
        item.setText(label);
        item.setTextColor(color);
        item.setTextSize(12);
        item.setGravity(Gravity.CENTER);
        // 触控高度：上下各 12dp 内边距 + 文字 ≈ 48dp，见 HANDOVER §15 待办。
        item.setPadding(UiUtil.dp(service, 16), UiUtil.dp(service, 12),
                UiUtil.dp(service, 16), UiUtil.dp(service, 12));
        item.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        item.setOnClickListener(listener);
        return item;
    }

    public void hideMenu() {
        if (captureMenu != null && captureMenu.getParent() != null
                && windowManager != null) {
            try {
                windowManager.removeView(captureMenu);
            } catch (Exception ignored) {
            }
        }
        captureMenu = null;
    }

    private void disableBubble() {
        captureBubbleDisabled = true;
        host.onBubbleDisabled();
        handler.removeCallbacks(longPressRunnable);
        hideMenu();
        host.removeSelectionLayer();
        if (captureBubble != null && captureBubble.getParent() != null
                && windowManager != null) {
            try {
                windowManager.removeView(captureBubble);
            } catch (Exception ignored) {
            }
        }
        captureBubble = null;
        Toast.makeText(service, "已关闭划；可在 App「悬浮取词」里点「开启划」恢复。",
                Toast.LENGTH_LONG).show();
    }
}
