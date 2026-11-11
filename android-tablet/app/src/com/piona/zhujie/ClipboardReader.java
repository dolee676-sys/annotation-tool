package com.piona.zhujie;

import android.accessibilityservice.AccessibilityService;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * 从 SelectionService 抽出的剪贴板取词。
 *
 * 原来的 trick 原样保留：读剪贴板前先往屏幕上挂一个 2×2 的透明焦点 View，
 * 拿到焦点后再读——不这样做，部分系统（OneNote 场景）读到的是旧剪贴板。
 * 读到的文字经 Listener 回到服务，由服务决定是否弹 chip；这里不碰 chip。
 */
public class ClipboardReader {
    public interface Listener {
        /** 读到文字（manual=true 表示用户在菜单里点了“读剪贴板”）。 */
        void onClipboardText(String text, Rect bounds, boolean manual);

        boolean captureOff();

        boolean copyChipEnabled();
    }

    private final AccessibilityService service;
    private final Handler handler;
    private final WindowManager windowManager;
    private final ClipboardManager clipboardManager;
    private final Listener listener;

    private View clipboardFocus;
    private WindowManager.LayoutParams clipboardFocusParams;
    private boolean clipboardReading;
    private boolean clipboardReadScheduled;
    private boolean clipboardReadManual;
    private Rect pendingClipboardBounds;
    private String lastClipboardText = "";
    private long lastClipboardChipAt;
    /** 最近一次用户点按的时间（毫秒）：裸剪贴板变化只认 3 秒内的点按。 */
    private long lastUserActionAt;
    /** 最近一次复制信号的时间（点了复制按钮 / 出现“已复制”提示，毫秒）。 */
    private long lastCopySignalAt;

    private ClipboardManager.OnPrimaryClipChangedListener clipboardListener;

    public ClipboardReader(AccessibilityService service, Handler handler,
                           WindowManager windowManager, ClipboardManager clipboardManager,
                           Listener listener) {
        this.service = service;
        this.handler = handler;
        this.windowManager = windowManager;
        this.clipboardManager = clipboardManager;
        this.listener = listener;
        this.clipboardListener = () -> {
            if (listener.captureOff()) {
                return;
            }
            // 裸剪贴板变化：应用后台自己写剪贴板（链接、验证码等）也会触发。
            // 只认 3 秒内有过用户动作的：点了复制按钮 / 刚点过什么。
            // OneNote 流程是“选中 → 点复制”，点按先到、剪贴变化后到，
            // 在窗口期内，不受影响；菜单里主动点的“读剪贴板”不走这里。
            long now = System.currentTimeMillis();
            long signalAt = Math.max(lastUserActionAt, lastCopySignalAt);
            if (signalAt <= 0
                    || now - signalAt > ChipGate.CLIPBOARD_SIGNAL_WINDOW_MS) {
                return;
            }
            scheduleRead(220, null);
        };
    }

    /** 服务收到任意点按事件时调：给裸剪贴板变化的判断用。 */
    public void noteUserAction(long now) {
        lastUserActionAt = now;
    }

    /** 服务看到复制信号（点了复制按钮 / 出现“已复制”提示）时调。 */
    public void noteCopySignal(long now) {
        lastCopySignalAt = now;
    }

    public void start() {
        if (clipboardManager != null) {
            clipboardManager.addPrimaryClipChangedListener(clipboardListener);
        }
    }

    public void stop() {
        if (clipboardManager != null) {
            try {
                clipboardManager.removePrimaryClipChangedListener(clipboardListener);
            } catch (Exception ignored) {
            }
        }
        removeClipboardFocus();
    }

    public void scheduleRead(long delayMs, Rect bounds) {
        if (clipboardReadScheduled) {
            if (bounds != null) {
                pendingClipboardBounds = new Rect(bounds);
            }
            return;
        }
        clipboardReadScheduled = true;
        pendingClipboardBounds = bounds == null ? null : new Rect(bounds);
        handler.postDelayed(() -> {
            clipboardReadScheduled = false;
            beginRead(false);
        }, Math.max(60, delayMs));
    }

    /** 菜单里的“读剪贴板”：手动触发，剪贴板为空时要给提示。 */
    public void readFromMenu() {
        beginRead(true);
    }

    private void beginRead(boolean manual) {
        if (windowManager == null || clipboardReading) {
            return;
        }
        if (!manual && !listener.copyChipEnabled()) {
            return;
        }
        clipboardReading = true;
        clipboardReadManual = manual;
        showClipboardFocus();
    }

    private void showClipboardFocus() {
        if (clipboardFocus != null) {
            return;
        }
        clipboardFocus = new View(service);
        clipboardFocus.setBackgroundColor(Color.TRANSPARENT);
        clipboardFocus.setFocusableInTouchMode(true);
        clipboardFocus.setOnFocusChangeListener((view, hasFocus) -> {
            if (hasFocus) {
                handler.postDelayed(this::readClipboardNow, 50);
            }
        });
        clipboardFocusParams = new WindowManager.LayoutParams(
                2,
                2,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM,
                PixelFormat.TRANSLUCENT);
        clipboardFocusParams.gravity = Gravity.TOP | Gravity.START;
        try {
            windowManager.addView(clipboardFocus, clipboardFocusParams);
        } catch (Exception exception) {
            clipboardFocus = null;
            handler.postDelayed(this::readClipboardNow, 80);
            return;
        }
        clipboardFocus.requestFocus();
        handler.postDelayed(this::readClipboardNow, 320);
    }

    private void readClipboardNow() {
        if (!clipboardReading) {
            return;
        }
        clipboardReading = false;
        boolean manual = clipboardReadManual;
        String text = readClipboardText();
        Rect anchor = pendingClipboardBounds == null
                ? null : new Rect(pendingClipboardBounds);
        pendingClipboardBounds = null;
        removeClipboardFocus();
        if (text == null || text.trim().isEmpty()) {
            if (manual) {
                Toast.makeText(service, "剪贴板里没有文字。先在 OneNote 里选中文字并点「复制」。",
                        Toast.LENGTH_LONG).show();
            }
            return;
        }
        text = text.trim();
        if (text.length() > SelectionState.MAX_TEXT) {
            text = text.substring(0, SelectionState.MAX_TEXT);
        }
        long now = System.currentTimeMillis();
        if (text.equals(lastClipboardText) && now - lastClipboardChipAt < 3000) {
            return;
        }
        lastClipboardText = text;
        lastClipboardChipAt = now;
        listener.onClipboardText(text, anchor, manual);
    }

    private void removeClipboardFocus() {
        View view = clipboardFocus;
        clipboardFocus = null;
        if (view != null && view.getParent() != null && windowManager != null) {
            try {
                windowManager.removeView(view);
            } catch (Exception ignored) {
            }
        }
    }

    private String readClipboardText() {
        if (clipboardManager == null) {
            return null;
        }
        try {
            if (!clipboardManager.hasPrimaryClip()) {
                return null;
            }
            ClipData clip = clipboardManager.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) {
                return null;
            }
            ClipDescription description = clip.getDescription();
            if (description != null) {
                boolean textType = description.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN)
                        || description.hasMimeType(ClipDescription.MIMETYPE_TEXT_HTML)
                        || description.hasMimeType(ClipDescription.MIMETYPE_TEXT_URILIST);
                if (!textType) {
                    return null;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    android.os.PersistableBundle extras = description.getExtras();
                    if (extras != null
                            && extras.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE, false)) {
                        return null;
                    }
                }
            }
            ClipData.Item item = clip.getItemAt(0);
            CharSequence value = item.getText();
            if (value == null) {
                value = item.coerceToText(service);
            }
            if (value == null) {
                return null;
            }
            String text = value.toString();
            if (description != null
                    && description.hasMimeType(ClipDescription.MIMETYPE_TEXT_HTML)
                    && text.indexOf('<') >= 0) {
                text = android.text.Html.fromHtml(
                        text, android.text.Html.FROM_HTML_MODE_LEGACY).toString();
            }
            return text;
        } catch (Exception exception) {
            return null;
        }
    }

    public boolean copyChipEnabled() {
        try {
            JSONObject settings = new JSONObject(Store.get(service, "settings", ""));
            return settings.optBoolean("copyChip", true);
        } catch (Exception exception) {
            return true;
        }
    }
}
