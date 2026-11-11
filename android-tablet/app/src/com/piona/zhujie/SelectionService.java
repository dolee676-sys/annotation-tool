package com.piona.zhujie;

import android.accessibilityservice.AccessibilityService;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;

public class SelectionService extends AccessibilityService {
    private static final int MAX_TEXT = 2000;
    private static final long PERIODIC_SCAN_MS = 1500;
    private static volatile boolean connected;
    private static volatile SelectionService instance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private LinearLayout chip;
    private WindowManager.LayoutParams chipParams;
    private WebView panelWeb;
    private FrameLayout panelRoot;
    private WindowManager.LayoutParams panelParams;
    private boolean panelPinned;
    private TextView captureBubble;
    private WindowManager.LayoutParams captureParams;
    private LinearLayout captureMenu;
    private WindowManager.LayoutParams captureMenuParams;
    private SelectionLayerView selectionLayer;
    private WindowManager.LayoutParams selectionLayerParams;
    private long selectionOcrToken;
    private TextView busyView;
    private WindowManager.LayoutParams busyParams;
    private boolean captureBubbleDisabled;
    private boolean longPressTriggered;
    private float bubbleDownX;
    private float bubbleDownY;
    private int bubbleStartX;
    private int bubbleStartY;
    private boolean bubbleMoved;
    private final Runnable longPressRunnable = this::showCaptureMenu;
    private String selectedText = "";
    private Rect selectedBounds;
    private long chipShownAt;
    private long chipProtectUntil;
    private String lastPanelText = "";
    private String dismissedText = "";
    private boolean suppressChip;
    private long lastSelectionEventAt;
    private long lastSelectionScanAt;
    private ClipboardManager clipboardManager;
    private View clipboardFocus;
    private WindowManager.LayoutParams clipboardFocusParams;
    private boolean clipboardReading;
    private boolean clipboardReadScheduled;
    private boolean clipboardReadManual;
    private Rect pendingClipboardBounds;
    private String lastClipboardText = "";
    private long lastClipboardChipAt;
    private final Runnable showRunnable = this::showChip;
    private final Runnable hideRunnable = () -> {
        if (!selectedText.isEmpty()) {
            dismissedText = selectedText;
        }
        hideChip();
        restoreCaptureBubble();
    };
    private final Runnable scanRunnable = this::scanActiveWindowForSelection;
    private final Runnable periodicScanRunnable = new Runnable() {
        @Override
        public void run() {
            maybeScanSelection();
            handler.postDelayed(this, PERIODIC_SCAN_MS);
        }
    };
    private final ClipboardManager.OnPrimaryClipChangedListener clipboardListener = () -> {
        if (isOwnAppActive()) {
            return;
        }
        if (captureOff()) {
            return;
        }
        scheduleClipboardRead(220, null);
    };

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        connected = true;
        instance = this;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        clipboardManager = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (clipboardManager != null) {
            clipboardManager.addPrimaryClipChangedListener(clipboardListener);
        }
        createCaptureBubble();
        applyCaptureMaster();
        handler.postDelayed(periodicScanRunnable, PERIODIC_SCAN_MS);
    }

    public static boolean isConnected() {
        return connected;
    }

    public static boolean isCaptureDisabled() {
        SelectionService service = instance;
        return service != null && service.captureBubbleDisabled;
    }

    /** 供 App 内按钮恢复「划」气泡；服务未连接时返回 false。 */
    public static boolean enableCaptureFromApp() {
        SelectionService service = instance;
        if (service == null || !connected) {
            return false;
        }
        service.handler.post(service::enableCaptureBubble);
        return true;
    }

    private void enableCaptureBubble() {
        captureBubbleDisabled = false;
        if (captureBubble == null) {
            createCaptureBubble();
        } else {
            captureBubble.setVisibility(View.VISIBLE);
        }
    }

    private boolean captureOff() {
        return "0".equals(Store.get(this, "captureEnabled", "1"));
    }

    /** 取词总开关：关闭时收起注/问、划、悬浮面板并停止扫描；开启时恢复划气泡。 */
    static void applyCaptureMaster() {
        SelectionService service = instance;
        if (service == null) {
            return;
        }
        service.handler.post(() -> {
            if (service.captureOff()) {
                service.hideChip();
                service.hideCaptureMenu();
                service.removeSelectionLayer();
                if (service.captureBubble != null) {
                    service.captureBubble.setVisibility(View.GONE);
                }
            } else {
                service.restoreCaptureBubble();
            }
        });
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        selectionOcrToken++;
        closeOverlay();
        hideChip();
        removeSelectionLayer();
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        if (captureParams != null) {
            captureParams.x = Math.max(0, metrics.widthPixels - dp(60));
            captureParams.y = metrics.heightPixels / 2;
            if (captureBubble != null && captureBubble.getParent() != null
                    && windowManager != null) {
                try {
                    windowManager.updateViewLayout(captureBubble, captureParams);
                } catch (Exception ignored) {
                }
            }
        }
        hideCaptureMenu();
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        connected = false;
        instance = null;
        handler.removeCallbacks(periodicScanRunnable);
        handler.removeCallbacks(scanRunnable);
        if (clipboardManager != null) {
            try {
                clipboardManager.removePrimaryClipChangedListener(clipboardListener);
            } catch (Exception ignored) {
            }
        }
        removeClipboardFocus();
        removeSelectionLayer();
        return super.onUnbind(intent);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) {
            return;
        }
        if (captureOff()) {
            return;
        }
        CharSequence packageName = event.getPackageName();
        if (packageName != null && getPackageName().contentEquals(packageName)) {
            return;
        }
        int type = event.getEventType();
        if (type == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            hideCaptureMenu();
            if (looksLikeCopyClick(event)) {
                scheduleClipboardRead(160, boundsOf(event.getSource()));
            }
            return;
        }
        if (type == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) {
            if (looksLikeCopiedNotice(event)) {
                scheduleClipboardRead(220, null);
            }
            return;
        }
        if (type != AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED) {
            if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                if (looksLikeCopiedNotice(event)) {
                    scheduleClipboardRead(220, null);
                }
                updateCaptureBubble(packageName);
                scheduleSelectionScan(220);
            } else if (type == AccessibilityEvent.TYPE_VIEW_LONG_CLICKED) {
                scheduleSelectionScan(160);
            } else if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                    || type == AccessibilityEvent.TYPE_VIEW_SCROLLED) {
                scheduleSelectionScan(350);
            }
            return;
        }
        lastSelectionEventAt = System.currentTimeMillis();
        dismissedText = "";
        if (event.isPassword()) {
            hideChip();
            return;
        }
        AccessibilityNodeInfo source = event.getSource();
        if (source != null && (source.isPassword() || source.isEditable())) {
            hideChip();
            return;
        }
        if (isInputFocused()) {
            hideChip();
            return;
        }
        String text = extractSelection(event, source);
        if (text == null || text.trim().isEmpty()) {
            suppressChip = false;
            lastPanelText = "";
            long now = System.currentTimeMillis();
            if (now < chipProtectUntil) {
                return;
            }
            if (now - chipShownAt > 1500) {
                scheduleHide(800);
            }
            return;
        }
        String cleaned = text.trim();
        if (suppressChip && cleaned.equals(lastPanelText)) {
            return;
        }
        suppressChip = false;
        lastPanelText = "";
        selectedText = cleaned;
        if (selectedText.length() > MAX_TEXT) {
            selectedText = selectedText.substring(0, MAX_TEXT);
        }
        selectedBounds = null;
        if (source != null) {
            Rect bounds = new Rect();
            source.getBoundsInScreen(bounds);
            if (bounds.width() > 0 && bounds.height() > 0) {
                selectedBounds = bounds;
            }
        }
        handler.removeCallbacks(showRunnable);
        handler.postDelayed(showRunnable, 120);
    }

    private String extractSelection(AccessibilityEvent event, AccessibilityNodeInfo source) {
        if (source != null && source.isEditable()) {
            return "";
        }
        if (source != null) {
            CharSequence full = source.getText();
            int start = source.getTextSelectionStart();
            int end = source.getTextSelectionEnd();
            if (full != null && start >= 0 && end > start && end <= full.length()) {
                CharSequence part = full.subSequence(start, end);
                if (part != null && part.toString().trim().length() > 0) {
                    return part.toString();
                }
            }
        }
        List<CharSequence> texts = event.getText();
        if (texts != null && !texts.isEmpty()) {
            StringBuilder builder = new StringBuilder();
            for (CharSequence text : texts) {
                if (text != null) {
                    builder.append(text);
                }
            }
            if (builder.length() > 0) {
                return builder.toString();
            }
        }
        if (source != null) {
            CharSequence full = source.getText();
            if (full != null && full.length() > 0 && full.length() <= 600) {
                return full.toString();
            }
        }
        return "";
    }

    private boolean looksLikeCopyClick(AccessibilityEvent event) {
        String label = labelOf(event).toLowerCase(Locale.ROOT);
        if (label.isEmpty()) {
            return false;
        }
        return label.contains("复制") || label.contains("拷贝")
                || label.contains("copy");
    }

    private boolean looksLikeCopiedNotice(AccessibilityEvent event) {
        String label = labelOf(event).toLowerCase(Locale.ROOT);
        if (label.isEmpty()) {
            return false;
        }
        return label.contains("已复制") || label.contains("复制到剪贴板")
                || label.contains("copied") || label.contains("clipboard");
    }

    private String labelOf(AccessibilityEvent event) {
        StringBuilder builder = new StringBuilder();
        appendLabel(builder, event.getContentDescription());
        List<CharSequence> texts = event.getText();
        if (texts != null) {
            for (CharSequence text : texts) {
                appendLabel(builder, text);
            }
        }
        AccessibilityNodeInfo source = event.getSource();
        if (source != null) {
            try {
                if (source.isClickable()) {
                    appendLabel(builder, source.getContentDescription());
                    appendLabel(builder, source.getText());
                }
            } catch (Exception ignored) {
            }
        }
        return builder.toString().trim();
    }

    private void appendLabel(StringBuilder builder, CharSequence value) {
        if (value == null) {
            return;
        }
        int length = Math.min(value.length(), 80);
        builder.append(value, 0, length).append(' ');
    }

    private Rect boundsOf(AccessibilityNodeInfo source) {
        if (source == null) {
            return null;
        }
        Rect bounds = new Rect();
        try {
            source.getBoundsInScreen(bounds);
        } catch (Exception exception) {
            return null;
        }
        if (bounds.width() <= 0 || bounds.height() <= 0) {
            return null;
        }
        int screenHeight = getResources().getDisplayMetrics().heightPixels;
        if (bounds.height() > screenHeight * 0.5f) {
            return null;
        }
        return bounds;
    }

    private boolean isOwnAppActive() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return false;
        }
        CharSequence packageName = root.getPackageName();
        return packageName != null && getPackageName().contentEquals(packageName);
    }

    private boolean isInputFocused() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return false;
        }
        try {
            AccessibilityNodeInfo focus = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            return focus != null && focus.isEditable();
        } catch (Exception exception) {
            return false;
        }
    }

    private void scheduleClipboardRead(long delayMs, Rect bounds) {
        if (!connected) {
            return;
        }
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
            beginClipboardRead(false);
        }, Math.max(60, delayMs));
    }

    private void beginClipboardRead(boolean manual) {
        if (!connected || windowManager == null || panelWeb != null || clipboardReading) {
            return;
        }
        if (!manual && !copyChipEnabled()) {
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
        clipboardFocus = new View(this);
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
        if (!connected) {
            clipboardReading = false;
            removeClipboardFocus();
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
                Toast.makeText(this, "剪贴板里没有文字。先在 OneNote 里选中文字并点「复制」。",
                        Toast.LENGTH_LONG).show();
            }
            return;
        }
        text = text.trim();
        if (text.length() > MAX_TEXT) {
            text = text.substring(0, MAX_TEXT);
        }
        long now = System.currentTimeMillis();
        if (text.equals(lastClipboardText) && now - lastClipboardChipAt < 3000) {
            return;
        }
        lastClipboardText = text;
        lastClipboardChipAt = now;
        selectedText = text;
        selectedBounds = anchor;
        suppressChip = false;
        lastPanelText = "";
        dismissedText = "";
        handler.removeCallbacks(showRunnable);
        handler.postDelayed(showRunnable, 50);
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
                value = item.coerceToText(this);
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

    private boolean copyChipEnabled() {
        try {
            JSONObject settings = new JSONObject(Store.get(this, "settings", ""));
            return settings.optBoolean("copyChip", true);
        } catch (Exception exception) {
            return true;
        }
    }

    private void scheduleSelectionScan(long delayMs) {
        handler.removeCallbacks(scanRunnable);
        handler.postDelayed(scanRunnable, delayMs);
    }

    private void maybeScanSelection() {
        if (!connected || windowManager == null) {
            return;
        }
        if (captureOff()) {
            return;
        }
        if (chip != null && chip.getParent() != null) {
            return;
        }
        if (System.currentTimeMillis() - lastSelectionEventAt < 2500) {
            return;
        }
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        if (power != null && !power.isInteractive()) {
            return;
        }
        scanActiveWindowForSelection();
    }

    private void scanActiveWindowForSelection() {
        if (!connected || windowManager == null) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastSelectionScanAt < 400) {
            return;
        }
        lastSelectionScanAt = now;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return;
        }
        CharSequence packageName = root.getPackageName();
        if (packageName != null && getPackageName().contentEquals(packageName)) {
            return;
        }
        SelectionHit hit = findSelection(root);
        if (hit == null) {
            dismissedText = "";
            if (suppressChip && now - chipShownAt > 1200) {
                suppressChip = false;
                lastPanelText = "";
            }
            return;
        }
        if (hit.text.equals(dismissedText)) {
            return;
        }
        if (suppressChip && hit.text.equals(lastPanelText)) {
            return;
        }
        if (hit.text.equals(selectedText) && chip != null && chip.getParent() != null) {
            return;
        }
        suppressChip = false;
        lastPanelText = "";
        selectedText = hit.text.length() > MAX_TEXT
                ? hit.text.substring(0, MAX_TEXT) : hit.text;
        selectedBounds = hit.bounds;
        handler.removeCallbacks(showRunnable);
        handler.postDelayed(showRunnable, 90);
    }

    private SelectionHit findSelection(AccessibilityNodeInfo root) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        int screenHeight = getResources().getDisplayMetrics().heightPixels;
        while (!queue.isEmpty() && visited < 2500) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            try {
                if (node.isEditable()) {
                    continue;
                }
                CharSequence text = node.getText();
                if (text != null && text.length() > 0) {
                    int start = node.getTextSelectionStart();
                    int end = node.getTextSelectionEnd();
                    if (start >= 0 && end > start && start < text.length()) {
                        int stop = Math.min(end, text.length());
                        String value = text.subSequence(start, stop).toString().trim();
                        if (!value.isEmpty()) {
                            Rect bounds = new Rect();
                            node.getBoundsInScreen(bounds);
                            if (bounds.width() <= 0 || bounds.height() <= 0
                                    || bounds.height() > screenHeight * 0.72f) {
                                bounds = null;
                            }
                            return new SelectionHit(value, bounds);
                        }
                    }
                }
                int count = node.getChildCount();
                for (int index = 0; index < count; index++) {
                    AccessibilityNodeInfo child = node.getChild(index);
                    if (child != null) {
                        queue.add(child);
                    }
                }
            } catch (Exception ignored) {
            }
        }
        return null;
    }

    private static final class SelectionHit {
        final String text;
        final Rect bounds;

        SelectionHit(String text, Rect bounds) {
            this.text = text;
            this.bounds = bounds;
        }
    }

    private void createCaptureBubble() {
        if (windowManager == null) {
            return;
        }
        captureBubble = new TextView(this);
        captureBubble.setText("划");
        captureBubble.setTextColor(0xFFF6F2EA);
        captureBubble.setTextSize(14);
        captureBubble.setGravity(Gravity.CENTER);
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xFF9A4B16);
        background.setCornerRadius(dp(22));
        captureBubble.setBackground(background);
        captureBubble.setElevation(dp(6));
        captureBubble.setOnTouchListener((view, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    hideCaptureMenu();
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
                    if (Math.abs(dx) > dp(6) || Math.abs(dy) > dp(6)) {
                        bubbleMoved = true;
                        handler.removeCallbacks(longPressRunnable);
                    }
                    DisplayMetrics metrics = getResources().getDisplayMetrics();
                    captureParams.x = Math.max(0, Math.min(
                            bubbleStartX + dx, metrics.widthPixels - dp(48)));
                    captureParams.y = Math.max(0, Math.min(
                            bubbleStartY + dy, metrics.heightPixels - dp(48)));
                    try {
                        windowManager.updateViewLayout(captureBubble, captureParams);
                    } catch (Exception ignored) {
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    handler.removeCallbacks(longPressRunnable);
                    if (!bubbleMoved && !longPressTriggered) {
                        enterSelectionMode();
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
                dp(44),
                dp(44),
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        captureParams.gravity = Gravity.TOP | Gravity.START;
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        captureParams.x = metrics.widthPixels - dp(60);
        captureParams.y = metrics.heightPixels / 2;
        try {
            windowManager.addView(captureBubble, captureParams);
        } catch (Exception exception) {
            captureBubble = null;
        }
    }

    private void updateCaptureBubble(CharSequence packageName) {
        if (captureBubble == null || captureBubbleDisabled) {
            return;
        }
        boolean own = packageName != null && getPackageName().contentEquals(packageName);
        captureBubble.setVisibility(own ? View.GONE : View.VISIBLE);
    }

    private void showCaptureMenu() {
        longPressTriggered = true;
        if (captureBubble == null || windowManager == null) {
            return;
        }
        if (captureMenu == null) {
            captureMenu = new LinearLayout(this);
            captureMenu.setOrientation(LinearLayout.VERTICAL);
            captureMenu.setPadding(dp(4), dp(4), dp(4), dp(4));
            GradientDrawable background = new GradientDrawable();
            background.setColor(0xF22A2723);
            background.setCornerRadius(dp(12));
            captureMenu.setBackground(background);
            captureMenu.setElevation(dp(6));
            captureMenu.addView(makeMenuItem("整页抓取", 0xFFF6F2EA,
                    view -> {
                        hideCaptureMenu();
                        captureActiveWindow();
                    }));
            captureMenu.addView(makeMenuItem("读剪贴板", 0xFFF6F2EA,
                    view -> readClipboardFromMenu()));
            captureMenu.addView(makeMenuItem("关闭划", 0xFFFFB4A8,
                    view -> disableCaptureBubble()));
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
        int x = captureParams.x - width - dp(8);
        if (x < dp(8)) {
            x = captureParams.x + dp(52);
        }
        captureMenuParams.x = x;
        captureMenuParams.y = Math.max(0, captureParams.y - height / 2 + dp(22));
        if (captureMenu.getParent() == null) {
            try {
                windowManager.addView(captureMenu, captureMenuParams);
            } catch (Exception ignored) {
            }
        }
    }

    private TextView makeMenuItem(String label, int color, View.OnClickListener listener) {
        TextView item = new TextView(this);
        item.setText(label);
        item.setTextColor(color);
        item.setTextSize(12);
        item.setGravity(Gravity.CENTER);
        item.setPadding(dp(12), dp(9), dp(12), dp(9));
        item.setBackgroundColor(Color.TRANSPARENT);
        item.setOnClickListener(listener);
        return item;
    }

    private void hideCaptureMenu() {
        if (captureMenu != null && captureMenu.getParent() != null
                && windowManager != null) {
            try {
                windowManager.removeView(captureMenu);
            } catch (Exception ignored) {
            }
        }
        captureMenu = null;
    }

    private void readClipboardFromMenu() {
        hideCaptureMenu();
        beginClipboardRead(true);
    }

    private void disableCaptureBubble() {
        captureBubbleDisabled = true;
        selectionOcrToken++;
        handler.removeCallbacks(longPressRunnable);
        hideCaptureMenu();
        removeSelectionLayer();
        if (captureBubble != null && captureBubble.getParent() != null
                && windowManager != null) {
            try {
                windowManager.removeView(captureBubble);
            } catch (Exception ignored) {
            }
        }
        captureBubble = null;
        Toast.makeText(this, "已关闭划；可在 App「悬浮取词」里点「开启划」恢复。",
                Toast.LENGTH_LONG).show();
    }

    private void captureActiveWindow() {
        hideCaptureMenu();
        hideChip();
        if (captureBubble != null) {
            captureBubble.setVisibility(View.GONE);
        }
        String text = collectWindowText();
        if (text.length() >= 200 && text.split("\n").length >= 4) {
            showOverlay(text, false, null, true);
            return;
        }
        captureScreenAndOcr();
    }

    private void enterSelectionMode() {
        selectionOcrToken++;
        hideCaptureMenu();
        hideChip();
        removeSelectionLayer();
        if (captureBubble != null) {
            captureBubble.setVisibility(View.GONE);
        }
        handler.postDelayed(this::captureForSelection, 120);
    }

    private void captureForSelection() {
        if (!connected) {
            return;
        }
        if (!ocrEnabled()) {
            failSelection("截图识图已关闭，可在设置→悬浮取词里开启。");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            failSelection("当前系统不支持截屏取词。");
            return;
        }
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(),
                    new AccessibilityService.TakeScreenshotCallback() {
                        @Override
                        public void onSuccess(AccessibilityService.ScreenshotResult result) {
                            HardwareBuffer buffer = result.getHardwareBuffer();
                            try {
                                Bitmap bitmap = Bitmap.wrapHardwareBuffer(
                                        buffer, result.getColorSpace());
                                if (bitmap == null) {
                                    failSelection("截屏失败。");
                                    return;
                                }
                                Bitmap copy = bitmap.copy(Bitmap.Config.RGB_565, false);
                                if (copy == null) {
                                    failSelection("截屏失败。");
                                    return;
                                }
                                showSelectionLayer(copy);
                            } catch (Exception exception) {
                                failSelection("截屏失败。");
                            } finally {
                                if (buffer != null) {
                                    buffer.close();
                                }
                            }
                        }

                        @Override
                        public void onFailure(int errorCode) {
                            failSelection("截屏失败（" + errorCode + "）。");
                        }
                    });
        } catch (Exception exception) {
            failSelection("截屏失败。");
        }
    }

    private void showSelectionLayer(Bitmap bitmap) {
        if (!connected) {
            bitmap.recycle();
            return;
        }
        removeSelectionLayer();
        if (windowManager == null) {
            bitmap.recycle();
            restoreCaptureBubble();
            return;
        }
        SelectionLayerView layer = new SelectionLayerView(this, bitmap,
                new SelectionLayerView.Listener() {
                    @Override
                    public void onSelected(Rect bitmapRect, Rect screenRect) {
                        runSelectionOcr(bitmapRect, screenRect);
                    }

                    @Override
                    public void onCancel() {
                        removeSelectionLayer();
                        restoreCaptureBubble();
                    }
                });
        selectionLayer = layer;
        selectionLayerParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM,
                PixelFormat.TRANSLUCENT);
        selectionLayerParams.gravity = Gravity.TOP | Gravity.START;
        try {
            windowManager.addView(layer, selectionLayerParams);
            layer.post(() -> layer.requestFocus());
        } catch (Exception exception) {
            selectionLayer = null;
            bitmap.recycle();
            restoreCaptureBubble();
            Toast.makeText(this, "无法显示划词层。", Toast.LENGTH_LONG).show();
        }
    }

    private void runSelectionOcr(Rect bitmapRect, Rect screenRect) {
        SelectionLayerView layer = selectionLayer;
        if (layer == null) {
            return;
        }
        Bitmap source = layer.getBitmap();
        if (source == null || source.isRecycled()) {
            failSelection("截屏已失效，请重划一次。");
            return;
        }
        Rect safe = new Rect(
                Math.max(0, bitmapRect.left),
                Math.max(0, bitmapRect.top),
                Math.min(source.getWidth(), bitmapRect.right),
                Math.min(source.getHeight(), bitmapRect.bottom));
        if (safe.width() < 2 || safe.height() < 2) {
            failSelection("选区太小，请重划一次。");
            return;
        }
        Bitmap crop;
        try {
            crop = Bitmap.createBitmap(source, safe.left, safe.top,
                    safe.width(), safe.height());
        } catch (Exception exception) {
            failSelection("截取选区失败。");
            return;
        }
        removeSelectionLayer();
        showBusy();
        restoreCaptureBubble();
        long token = ++selectionOcrToken;
        new Thread(() -> {
            try {
                int width = crop.getWidth();
                int height = crop.getHeight();
                int max = Math.max(width, height);
                Bitmap scaled = crop;
                if (max > 1600) {
                    float scale = 1600f / max;
                    scaled = Bitmap.createScaledBitmap(crop,
                            Math.max(1, Math.round(width * scale)),
                            Math.max(1, Math.round(height * scale)), true);
                }
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                scaled.compress(Bitmap.CompressFormat.JPEG, 88, output);
                if (scaled != crop) {
                    scaled.recycle();
                }
                crop.recycle();
                String[] config = ocrConfig();
                if (config == null || config[1].isEmpty()) {
                    handler.post(() -> {
                        if (token == selectionOcrToken) {
                            failSelection("识图需要通义千问 Key：先去设置里填好。");
                        }
                    });
                    return;
                }
                String base64 = Base64.encodeToString(
                        output.toByteArray(), Base64.NO_WRAP);
                ScreenOcr.recognize(config[0], config[1], base64, (text, error) -> {
                    if (error != null) {
                        handler.post(() -> {
                            if (token == selectionOcrToken) {
                                failSelection(error);
                            }
                        });
                        return;
                    }
                    handler.post(() -> {
                        if (!connected || token != selectionOcrToken) {
                            return;
                        }
                        String cleaned = text == null ? "" : text.trim();
                        if (cleaned.isEmpty()) {
                            failSelection("没有识别到文字，请重划一次。");
                            return;
                        }
                        if (cleaned.length() > MAX_TEXT) {
                            cleaned = cleaned.substring(0, MAX_TEXT);
                        }
                        selectedText = cleaned;
                        Rect bounds = new Rect(screenRect);
                        int screenHeight = getResources()
                                .getDisplayMetrics().heightPixels;
                        if (bounds.width() <= 0 || bounds.height() <= 0
                                || bounds.bottom <= 0 || bounds.top >= screenHeight) {
                            bounds = null;
                        }
                        selectedBounds = bounds;
                        suppressChip = false;
                        lastPanelText = "";
                        dismissedText = "";
                        hideBusy();
                        showChip();
                        restoreCaptureBubble();
                    });
                });
            } catch (Exception exception) {
                handler.post(() -> {
                    if (token == selectionOcrToken) {
                        failSelection("识别选区失败。");
                    }
                });
            }
        }, "zhujie-selection-ocr").start();
    }

    private void failSelection(String message) {
        hideBusy();
        removeSelectionLayer();
        restoreCaptureBubble();
        if (message != null && !message.isEmpty()) {
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        }
    }

    private void removeSelectionLayer() {
        SelectionLayerView layer = selectionLayer;
        selectionLayer = null;
        if (layer != null) {
            boolean removed = layer.getParent() == null;
            if (!removed && windowManager != null) {
                try {
                    windowManager.removeView(layer);
                    removed = true;
                } catch (Exception ignored) {
                }
            }
            if (removed) {
                handler.postDelayed(layer::release, 1200);
            }
        }
    }

    private void restoreCaptureBubble() {
        if (captureOff()) {
            if (captureBubble != null) {
                captureBubble.setVisibility(View.GONE);
            }
            return;
        }
        if (captureBubble != null && !captureBubbleDisabled) {
            captureBubble.setVisibility(View.VISIBLE);
        }
    }

    private void captureScreenAndOcr() {
        if (!ocrEnabled()) {
            failOcr("截图识图已关闭，可在设置→悬浮取词里开启。");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            failOcr("当前系统不支持截屏识别。");
            return;
        }
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(),
                    new AccessibilityService.TakeScreenshotCallback() {
                        @Override
                        public void onSuccess(AccessibilityService.ScreenshotResult result) {
                            HardwareBuffer buffer = result.getHardwareBuffer();
                            try {
                                Bitmap bitmap = Bitmap.wrapHardwareBuffer(
                                        buffer, result.getColorSpace());
                                if (bitmap == null) {
                                    failOcr("截屏失败。");
                                    return;
                                }
                                Bitmap copy = bitmap.copy(Bitmap.Config.ARGB_8888, false);
                                if (copy == null) {
                                    failOcr("截屏失败。");
                                    return;
                                }
                                showBusy();
                                new Thread(() -> runOcr(copy), "zhujie-ocr-prep").start();
                            } catch (Exception exception) {
                                failOcr("截屏失败。");
                            } finally {
                                if (buffer != null) {
                                    buffer.close();
                                }
                            }
                        }

                        @Override
                        public void onFailure(int errorCode) {
                            failOcr("截屏失败（" + errorCode + "）。");
                        }
                    });
        } catch (Exception exception) {
            failOcr("截屏失败。");
        }
    }

    private void runOcr(Bitmap bitmap) {
        try {
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            int max = Math.max(width, height);
            Bitmap scaled = bitmap;
            if (max > 1600) {
                float scale = 1600f / max;
                scaled = Bitmap.createScaledBitmap(bitmap,
                        Math.max(1, Math.round(width * scale)),
                        Math.max(1, Math.round(height * scale)), true);
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 82, output);
            if (scaled != bitmap) {
                scaled.recycle();
            }
            bitmap.recycle();
            String base64 = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
            String[] config = ocrConfig();
            if (config == null || config[1].isEmpty()) {
                failOcr("识图需要通义千问 Key：先去设置里填好。");
                return;
            }
            ScreenOcr.recognize(config[0], config[1], base64, (text, error) -> {
                if (error != null) {
                    failOcr(error);
                    return;
                }
                handler.post(() -> {
                    hideBusy();
                    showOverlay(text, false, null, true);
                });
            });
        } catch (Exception exception) {
            failOcr("识图失败。");
        }
    }

    private boolean ocrEnabled() {
        try {
            JSONObject settings = new JSONObject(Store.get(this, "settings", ""));
            return settings.optBoolean("ocrEnabled", true);
        } catch (Exception exception) {
            return true;
        }
    }

    private String[] ocrConfig() {
        try {
            JSONObject settings = new JSONObject(Store.get(this, "settings", ""));
            JSONObject keys = settings.optJSONObject("keys");
            String key = keys == null ? "" : keys.optString("qwen", "");
            if (key.isEmpty() && "qwen".equals(settings.optString("providerId"))) {
                key = settings.optString("apiKey", "");
            }
            String base = "https://dashscope.aliyuncs.com/compatible-mode/v1";
            if ("qwen".equals(settings.optString("providerId"))) {
                String custom = settings.optString("customBaseUrl", "");
                if (!custom.isEmpty() && AiClient.baseUrlError(custom) == null) {
                    base = custom;
                }
            }
            return new String[]{base, key};
        } catch (Exception exception) {
            return null;
        }
    }

    private void showBusy() {
        if (busyView != null || windowManager == null) {
            return;
        }
        busyView = new TextView(this);
        busyView.setText("识别中…");
        busyView.setTextColor(0xFFF6F2EA);
        busyView.setTextSize(13);
        busyView.setGravity(Gravity.CENTER);
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xE62A2723);
        background.setCornerRadius(dp(12));
        busyView.setBackground(background);
        busyView.setPadding(dp(16), dp(10), dp(16), dp(10));
        busyParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        busyParams.gravity = Gravity.CENTER;
        try {
            windowManager.addView(busyView, busyParams);
        } catch (Exception exception) {
            busyView = null;
        }
    }

    private void hideBusy() {
        if (busyView != null && busyView.getParent() != null && windowManager != null) {
            try {
                windowManager.removeView(busyView);
            } catch (Exception ignored) {
            }
        }
        busyView = null;
    }

    private void failOcr(String message) {
        handler.post(() -> {
            hideBusy();
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
            restoreCaptureBubble();
        });
    }

    private String collectWindowText() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return "";
        }
        CharSequence packageName = root.getPackageName();
        if (packageName != null && getPackageName().contentEquals(packageName)) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        HashSet<String> seen = new HashSet<>();
        collectNode(root, builder, seen, 0);
        return builder.toString().trim();
    }

    private void collectNode(AccessibilityNodeInfo node, StringBuilder builder,
                             HashSet<String> seen, int depth) {
        if (node == null || depth > 50 || builder.length() > 20000) {
            return;
        }
        CharSequence text = node.getText();
        if (text != null) {
            String value = text.toString().trim();
            if (!value.isEmpty() && value.length() <= 20000 && seen.add(value)) {
                builder.append(value).append('\n');
            }
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            collectNode(node.getChild(i), builder, seen, depth + 1);
        }
    }

    private void showChip() {
        if (selectedText.isEmpty() || windowManager == null) {
            return;
        }
        if (captureOff()) {
            return;
        }
        if (chip == null) {
            createChip();
        }
        updateChipPosition();
        if (chip.getParent() == null) {
            try {
                windowManager.addView(chip, chipParams);
            } catch (Exception exception) {
                Toast.makeText(this, "注/问按钮显示失败，请再划一次。",
                        Toast.LENGTH_LONG).show();
                return;
            }
        }
        chipShownAt = System.currentTimeMillis();
        chipProtectUntil = chipShownAt + 6000;
        handler.removeCallbacks(hideRunnable);
        handler.postDelayed(hideRunnable, 8000);
    }

    private void createChip() {
        chip = new LinearLayout(this);
        chip.setOrientation(LinearLayout.HORIZONTAL);
        chip.setGravity(Gravity.CENTER_VERTICAL);
        chip.setPadding(dp(4), dp(4), dp(4), dp(4));
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xFF2A2723);
        background.setCornerRadius(dp(12));
        chip.setBackground(background);
        chip.setElevation(dp(8));

        TextView annotate = makeButton("注");
        TextView ask = makeButton("问");
        annotate.setOnClickListener(view -> openPanel(false));
        ask.setOnClickListener(view -> openPanel(true));
        chip.addView(annotate);
        chip.addView(ask);

        chipParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        chipParams.gravity = Gravity.TOP | Gravity.START;
    }

    private TextView makeButton(String label) {
        TextView button = new TextView(this);
        button.setText(label);
        button.setTextColor(0xFFF6F2EA);
        button.setTextSize(14);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(15), dp(8), dp(15), dp(8));
        button.setBackgroundColor(Color.TRANSPARENT);
        return button;
    }

    private void updateChipPosition() {
        if (chip == null || chipParams == null) {
            return;
        }
        chip.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED);
        int width = chip.getMeasuredWidth();
        int height = chip.getMeasuredHeight();
        int screenWidth = getResources().getDisplayMetrics().widthPixels;
        int screenHeight = getResources().getDisplayMetrics().heightPixels;
        int x;
        int y;
        if (selectedBounds != null && selectedBounds.height() < screenHeight * 0.72) {
            x = selectedBounds.centerX() - width / 2;
            y = selectedBounds.top - height - dp(10);
            if (y < dp(40)) {
                y = selectedBounds.bottom + dp(10);
            }
        } else {
            x = screenWidth - width - dp(22);
            y = screenHeight - height - dp(150);
        }
        x = Math.max(dp(8), Math.min(x, screenWidth - width - dp(8)));
        y = Math.max(dp(40), Math.min(y, screenHeight - height - dp(24)));
        chipParams.x = x;
        chipParams.y = y;
        if (chip.getParent() != null) {
            try {
                windowManager.updateViewLayout(chip, chipParams);
            } catch (Exception ignored) {
            }
        }
    }

    private void openPanel(boolean ask) {
        String text = selectedText;
        Rect bounds = selectedBounds == null ? null : new Rect(selectedBounds);
        if (text.isEmpty()) {
            return;
        }
        lastPanelText = text;
        suppressChip = true;
        hideChip();
        showOverlay(text, ask, bounds, false);
    }

    private void showOverlay(String text, boolean ask, Rect bounds, boolean capture) {
        closeOverlay();
        if (windowManager == null) {
            return;
        }
        if (captureBubble != null) {
            captureBubble.setVisibility(View.GONE);
        }
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int screenWidth = metrics.widthPixels;
        int screenHeight = metrics.heightPixels;
        int cardWidth = capture
                ? Math.min(dp(430), Math.max(dp(320), Math.round(screenWidth * 0.44f)))
                : Math.min(dp(460), Math.max(dp(320), Math.round(screenWidth * 0.46f)));
        int cardHeight = Math.min(dp(560),
                Math.max(dp(420), Math.round(screenHeight * 0.64f)));
        int x;
        int y;
        if (capture) {
            int bubbleX = captureParams == null
                    ? screenWidth - dp(60) : captureParams.x;
            int bubbleY = captureParams == null
                    ? screenHeight / 2 : captureParams.y;
            if (bubbleX + dp(22) > screenWidth / 2) {
                x = bubbleX - cardWidth - dp(12);
            } else {
                x = bubbleX + dp(52);
            }
            y = bubbleY + dp(22) - cardHeight / 2;
        } else if (bounds != null && bounds.width() > 0) {
            if (bounds.right + cardWidth + dp(16) <= screenWidth) {
                x = bounds.right + dp(12);
            } else {
                x = bounds.left - cardWidth - dp(12);
            }
            y = bounds.centerY() - cardHeight / 2;
        } else {
            x = screenWidth - cardWidth - dp(20);
            y = (screenHeight - cardHeight) / 2;
        }
        x = Math.max(dp(8), Math.min(x, screenWidth - cardWidth - dp(8)));
        y = Math.max(dp(40), Math.min(y, screenHeight - cardHeight - dp(24)));

        panelPinned = false;
        panelWeb = new WebView(this);
        WebSettings settings = panelWeb.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        panelWeb.setBackgroundColor(Color.TRANSPARENT);
        panelWeb.setWebViewClient(new SafeWebViewClient(this));
        panelWeb.setOnTouchListener((view, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_OUTSIDE) {
                if (!panelPinned) {
                    closeOverlay();
                    return true;
                }
                return false;
            }
            return false;
        });
        panelWeb.addJavascriptInterface(
                new OverlayBridge(this, panelWeb, text, ask, this::closeOverlay,
                        this::moveOverlay, pinned -> panelPinned = pinned),
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

        FrameLayout root = new FrameLayout(this) {
            @Override
            public boolean dispatchTouchEvent(MotionEvent event) {
                if (event.getActionMasked() == MotionEvent.ACTION_OUTSIDE) {
                    if (!panelPinned) {
                        closeOverlay();
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

        PanelDragHandle handle = new PanelDragHandle(this);
        int handleWidth = Math.max(dp(110), cardWidth - dp(190));
        root.addView(handle, new FrameLayout.LayoutParams(
                handleWidth, dp(56), Gravity.TOP | Gravity.START));
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
                        DisplayMetrics metrics = getResources().getDisplayMetrics();
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
            closeOverlay();
        }
    }

    private void closeOverlay() {
        WebView web = panelWeb;
        AiClient.cancelOwner(web);
        FrameLayout root = panelRoot;
        panelRoot = null;
        panelWeb = null;
        panelPinned = false;
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
            try {
                web.removeJavascriptInterface("AndroidBridge");
                web.stopLoading();
                web.destroy();
            } catch (Exception ignored) {
            }
        }
        restoreCaptureBubble();
    }

    private void moveOverlay(int dx, int dy) {
        View target = panelRoot != null ? panelRoot : panelWeb;
        if (target == null || panelParams == null || windowManager == null) {
            return;
        }
        DisplayMetrics metrics = getResources().getDisplayMetrics();
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

    private void hideChip() {
        handler.removeCallbacks(showRunnable);
        handler.removeCallbacks(hideRunnable);
        selectedText = "";
        selectedBounds = null;
        if (chip != null && chip.getParent() != null && windowManager != null) {
            try {
                windowManager.removeView(chip);
            } catch (Exception ignored) {
            }
        }
    }

    private void scheduleHide(long delayMs) {
        handler.removeCallbacks(hideRunnable);
        handler.postDelayed(hideRunnable, delayMs);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onInterrupt() {
        hideChip();
    }

    @Override
    public void onDestroy() {
        connected = false;
        instance = null;
        selectionOcrToken++;
        handler.removeCallbacks(periodicScanRunnable);
        handler.removeCallbacks(scanRunnable);
        handler.removeCallbacks(showRunnable);
        handler.removeCallbacks(hideRunnable);
        if (clipboardManager != null) {
            try {
                clipboardManager.removePrimaryClipChangedListener(clipboardListener);
            } catch (Exception ignored) {
            }
        }
        removeClipboardFocus();
        removeSelectionLayer();
        closeOverlay();
        hideChip();
        hideBusy();
        hideCaptureMenu();
        if (captureBubble != null && captureBubble.getParent() != null && windowManager != null) {
            try {
                windowManager.removeView(captureBubble);
            } catch (Exception ignored) {
            }
        }
        captureBubble = null;
        super.onDestroy();
    }
}