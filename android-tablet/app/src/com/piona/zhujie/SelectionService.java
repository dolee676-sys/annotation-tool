package com.piona.zhujie;

import android.accessibilityservice.AccessibilityService;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * 无障碍取词服务（协调器）。
 *
 * 原来 1758 行的上帝类已拆开，职责现在是：
 * - 本类：生命周期、事件分发、周期扫描调度、取词总开关。
 * - {@link SelectionFinder}：在窗口里找选区 / 从事件里取选区。
 * - {@link ClipboardReader}：剪贴板取词（含 2×2 焦点 View 的读法）。
 * - {@link CaptureBubble}：屏幕边缘「划」气泡 + 长按菜单。
 * - {@link ChipOverlay}：「注 / 问」小条。
 * - {@link OverlayPanel}：悬浮注解面板（WebView）。
 * - {@link ScreenshotOcr}：截屏取词 / 整页 OCR（含忙碌提示）。
 * - {@link WindowTextCollector}：整页抓取时收窗口文字。
 * - {@link SelectionState}：各拆分类共享的选中态。
 *
 * 行为与拆分前一致；取词核心判断（密码/输入框不弹 chip、OwnApp 不取词、
 * 1.5 秒周期扫描 + 事件触发扫描）一字未动，只是换了位置。
 */
public class SelectionService extends AccessibilityService
        implements ClipboardReader.Listener, CaptureBubble.Host,
        ChipOverlay.Host, OverlayPanel.Host, ScreenshotOcr.Host {
    private static final long PERIODIC_SCAN_MS = 1500;
    private static volatile boolean connected;
    private static volatile SelectionService instance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final SelectionState state = new SelectionState();
    private WindowManager windowManager;
    private ClipboardManager clipboardManager;
    private ClipboardReader clipboardReader;
    private CaptureBubble captureBubble;
    private ChipOverlay chipOverlay;
    private OverlayPanel overlayPanel;
    private ScreenshotOcr screenshotOcr;

    private final Runnable scanRunnable = this::scanActiveWindowForSelection;
    private final Runnable periodicScanRunnable = new Runnable() {
        @Override
        public void run() {
            maybeScanSelection();
            handler.postDelayed(this, PERIODIC_SCAN_MS);
        }
    };

    /**
     * “划”气泡看门狗：每 1.5 秒检查一次，气泡丢了就找回来。
     * 0.1.40 上 Rick 遇到气泡“用着用着又消失了”——隐藏路径多（点划
     * 藏气泡、面板藏气泡、总开关藏气泡），任何一条漏恢复，气泡就再
     * 也不回来。逐条对照 0.1.38 没找到改坏的一步，所以不再赌“每条
     * 路都记得恢复”，加一道兜底：只要不是本该藏着的状态就恢复。
     * 判断在 BubbleWatchdog（纯函数，可单测），这里只做接线。
     */
    private final Runnable bubbleWatchdogRunnable = new Runnable() {
        @Override
        public void run() {
            maybeRestoreBubble();
            handler.postDelayed(this, PERIODIC_SCAN_MS);
        }
    };

    private void maybeRestoreBubble() {
        if (!connected || windowManager == null) {
            return;
        }
        if (captureBubble == null || chipOverlay == null
                || overlayPanel == null || screenshotOcr == null) {
            return;
        }
        if (!BubbleWatchdog.shouldRestore(captureOff(), captureBubble.isDisabled(),
                overlayPanel.isOpen(), screenshotOcr.isSelectionLayerShowing(),
                screenshotOcr.isSelectionPending())) {
            return;
        }
        captureBubble.ensureVisible();
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        connected = true;
        instance = this;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        clipboardManager = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboardReader = new ClipboardReader(this, handler, windowManager,
                clipboardManager, this);
        clipboardReader.start();
        captureBubble = new CaptureBubble(this, handler, windowManager, this);
        chipOverlay = new ChipOverlay(this, handler, windowManager, this);
        overlayPanel = new OverlayPanel(this, handler, windowManager, this);
        screenshotOcr = new ScreenshotOcr(this, handler, windowManager, this);
        captureBubble.create();
        applyCaptureMaster();
        handler.postDelayed(periodicScanRunnable, PERIODIC_SCAN_MS);
        handler.postDelayed(bubbleWatchdogRunnable, PERIODIC_SCAN_MS);
    }

    public static boolean isConnected() {
        return connected;
    }

    public static boolean isCaptureDisabled() {
        SelectionService service = instance;
        return service != null && service.captureBubble != null
                && service.captureBubble.isDisabled();
    }

    /** 供 App 内按钮恢复「划」气泡；服务未连接时返回 false。 */
    public static boolean enableCaptureFromApp() {
        SelectionService service = instance;
        if (service == null || !connected) {
            return false;
        }
        service.handler.post(() -> service.captureBubble.enable());
        return true;
    }

    public boolean captureOff() {
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
                service.chipOverlay.hide();
                service.captureBubble.hideMenu();
                service.screenshotOcr.removeSelectionLayer();
                service.captureBubble.setVisible(false);
            } else {
                service.restoreCaptureBubble();
            }
        });
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        screenshotOcr.invalidate();
        overlayPanel.close();
        chipOverlay.hide();
        screenshotOcr.removeSelectionLayer();
        captureBubble.onConfigurationChanged(newConfig);
        captureBubble.hideMenu();
    }

    @Override
    public boolean onUnbind(Intent intent) {
        connected = false;
        instance = null;
        handler.removeCallbacks(periodicScanRunnable);
        handler.removeCallbacks(bubbleWatchdogRunnable);
        handler.removeCallbacks(scanRunnable);
        clipboardReader.stop();
        screenshotOcr.removeSelectionLayer();
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
        long now = System.currentTimeMillis();
        if (type == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            // 点按本身绝不弹 chip，只记时间：给剪贴板“用户刚复制”的判断用。
            state.lastClickAt = now;
            clipboardReader.noteUserAction(now);
            captureBubble.hideMenu();
            if (SelectionFinder.looksLikeCopyClick(event)) {
                state.lastCopySignalAt = now;
                clipboardReader.noteCopySignal(now);
                clipboardReader.scheduleRead(160,
                        SelectionFinder.boundsOf(event.getSource(),
                                getResources().getDisplayMetrics().heightPixels));
            }
            return;
        }
        if (type == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) {
            if (SelectionFinder.looksLikeCopiedNotice(event)) {
                state.lastCopySignalAt = now;
                clipboardReader.noteCopySignal(now);
                clipboardReader.scheduleRead(220, null);
            }
            return;
        }
        if (type != AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED) {
            if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                if (SelectionFinder.looksLikeCopiedNotice(event)) {
                    state.lastCopySignalAt = now;
                    clipboardReader.noteCopySignal(now);
                    clipboardReader.scheduleRead(220, null);
                }
                // 窗口切换是选区手势：扫描补漏只认 5 秒内的手势（ChipGate）。
                state.lastGestureAt = now;
                captureBubble.updateForPackage(packageName);
                scheduleSelectionScan(220);
            } else if (type == AccessibilityEvent.TYPE_VIEW_LONG_CLICKED) {
                // 长按是选区手势：随后 160ms 的扫描可以弹 chip。
                state.lastGestureAt = now;
                scheduleSelectionScan(160);
            } else if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                    || type == AccessibilityEvent.TYPE_VIEW_SCROLLED) {
                // 内容变化 / 滚动只是补漏触发器，不是手势：扫描能不能弹，
                // 由 ChipGate 按“最近手势在 5 秒内”决定，这里不刷新手势时间。
                scheduleSelectionScan(350);
            }
            return;
        }
        state.lastSelectionEventAt = now;
        if (event.isPassword()) {
            chipOverlay.hide();
            return;
        }
        AccessibilityNodeInfo source = event.getSource();
        if (source != null && (source.isPassword() || source.isEditable())) {
            chipOverlay.hide();
            return;
        }
        if (isInputFocused()) {
            chipOverlay.hide();
            return;
        }
        // extractSelection 只认真实选区区间（开始 < 结束）：点一下挪光标、
        // 点一下短段落聚焦，拿到的都是空串，不弹。
        String text = SelectionFinder.extractSelection(event, source);
        if (text == null || text.trim().isEmpty()) {
            // 选区没了（用户点走了 / 光标挪走了）：立刻把当前这段记成
            // dismissed，而不是把 dismissed 清掉——否则下一次周期扫描
            // 又会把它当成新选区捞出来重弹（旧 bug）。
            state.recordDismissed();
            state.clearSelection();
            state.suppressChip = false;
            state.lastPanelText = "";
            if (now < state.chipProtectUntil) {
                return;
            }
            // 选区已清空且过了保护期：150ms 内收起。原来是前面还有一道
            // 1500ms 的关卡、再加 800ms 延迟，点走后小框要拖很久才消失。
            chipOverlay.hideDelayed(150);
            return;
        }
        String cleaned = text.trim();
        // 真选区事件：刷新手势与“新鲜选区”时间，扫描补漏认这个。
        state.lastGestureAt = now;
        state.lastFreshSelectionAt = now;
        Rect bounds = null;
        if (source != null) {
            Rect rect = new Rect();
            source.getBoundsInScreen(rect);
            if (rect.width() > 0 && rect.height() > 0) {
                bounds = rect;
            }
        }
        // 同一段刚被 dismiss（冷却期内、同一位置）不弹；面板压着的不弹；
        // 已经在展示的同一段不重复弹。判断在 ChipGate，可单测。
        if (!ChipGate.shouldShowSelection(cleaned, toGateBounds(bounds), now, snapshot())) {
            return;
        }
        state.dismissedText = "";
        state.dismissedBounds = null;
        state.suppressChip = false;
        state.lastPanelText = "";
        state.setSelected(cleaned, bounds);
        state.lastShownText = cleaned;
        state.lastShownBounds = bounds == null ? null : new Rect(bounds);
        chipOverlay.showDelayed(120);
    }

    /** 把 android.graphics.Rect 转成 ChipGate 的纯数据 Bounds。 */
    private static ChipGate.Bounds toGateBounds(Rect rect) {
        if (rect == null) {
            return null;
        }
        return ChipGate.Bounds.of(rect.left, rect.top, rect.right, rect.bottom);
    }

    /** 从当前选中态拼 ChipGate 快照（只读拷贝）。 */
    private ChipGate.Snapshot snapshot() {
        ChipGate.Snapshot s = new ChipGate.Snapshot();
        s.shownText = state.lastShownText;
        s.shownBounds = toGateBounds(state.lastShownBounds);
        s.dismissedText = state.dismissedText;
        s.dismissedBounds = toGateBounds(state.dismissedBounds);
        s.dismissedAt = state.dismissedAt;
        s.lastFreshSelectionAt = state.lastFreshSelectionAt;
        s.lastGestureAt = state.lastGestureAt;
        s.suppressChip = state.suppressChip;
        s.panelText = state.lastPanelText;
        s.chipShowing = chipOverlay.isShowing();
        s.currentText = state.selectedText;
        return s;
    }

    private boolean isOwnAppActive() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return false;
        }
        try {
            CharSequence packageName = root.getPackageName();
            return packageName != null && getPackageName().contentEquals(packageName);
        } finally {
            // getRootInActiveWindow() 拿到的 root 必须由调用方 recycle，
            // 否则每次调用都漏一个 native 节点（周期扫描 1.5 秒一次）。
            try {
                root.recycle();
            } catch (Exception ignored) {
            }
        }
    }

    private boolean isInputFocused() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return false;
        }
        try {
            AccessibilityNodeInfo focus = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (focus == null) {
                return false;
            }
            try {
                return focus.isEditable();
            } finally {
                try {
                    focus.recycle();
                } catch (Exception ignored) {
                }
            }
        } catch (Exception exception) {
            return false;
        } finally {
            try {
                root.recycle();
            } catch (Exception ignored) {
            }
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
        if (chipOverlay.isShowing()) {
            return;
        }
        if (System.currentTimeMillis() - state.lastSelectionEventAt < 2500) {
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
        if (now - state.lastSelectionScanAt < 400) {
            return;
        }
        state.lastSelectionScanAt = now;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return;
        }
        try {
            CharSequence packageName = root.getPackageName();
            if (packageName != null && getPackageName().contentEquals(packageName)) {
                return;
            }
            SelectionFinder.Hit hit = SelectionFinder.findSelection(root,
                    getResources().getDisplayMetrics().heightPixels);
            if (hit == null) {
                // 没找到选区：什么都不清。旧版这里把 dismissedText 清掉，
                // 于是刚被 dismiss 的旧选区在下一次扫描里又会被当成新的弹出来。
                if (state.suppressChip && now - state.chipShownAt > 1200) {
                    state.suppressChip = false;
                    state.lastPanelText = "";
                }
                return;
            }
            // 补漏扫描只认“最近有选区手势”的新选区：没有手势（没选过、没长按、
            // 没切窗口）时发现的选区，一律视为旧选区残留，不弹。判断在 ChipGate。
            if (!ChipGate.shouldShowScan(hit.text, toGateBounds(hit.bounds), now, snapshot())) {
                return;
            }
            state.dismissedText = "";
            state.dismissedBounds = null;
            state.suppressChip = false;
            state.lastPanelText = "";
            state.setSelected(hit.text, hit.bounds);
            state.lastShownText = hit.text;
            state.lastShownBounds = hit.bounds == null ? null : new Rect(hit.bounds);
            chipOverlay.showDelayed(90);
        } finally {
            // findSelection 只回收它自己展开的节点，root 由这里回收。
            try {
                root.recycle();
            } catch (Exception ignored) {
            }
        }
    }

    // ---- ClipboardReader.Listener ----
    @Override
    public void onClipboardText(String text, Rect bounds, boolean manual) {
        long now = System.currentTimeMillis();
        // 手动“读剪贴板”是用户主动点的，直接放行；自动触发的只认 3 秒内
        // 有过用户复制动作（点了复制 / 出现“已复制” / 刚点过什么）的情况，
        // 应用后台自己写剪贴板不弹。判断在 ChipGate，可单测。
        long signalAt = manual ? now
                : Math.max(state.lastCopySignalAt, state.lastClickAt);
        if (!ChipGate.shouldShowClipboard(text, now, snapshot(), signalAt)) {
            return;
        }
        state.setSelected(text, bounds);
        state.dismissedText = "";
        state.dismissedBounds = null;
        state.suppressChip = false;
        state.lastPanelText = "";
        state.lastShownText = text.trim();
        state.lastShownBounds = bounds == null ? null : new Rect(bounds);
        chipOverlay.showDelayed(50);
    }

    @Override
    public boolean copyChipEnabled() {
        return clipboardReader.copyChipEnabled();
    }

    // ---- CaptureBubble.Host ----
    @Override
    public void enterSelectionMode() {
        state.selectionOcrToken++;
        captureBubble.hideMenu();
        chipOverlay.hide();
        screenshotOcr.removeSelectionLayer();
        captureBubble.setVisible(false);
        // 先把 pending 置上：点划到截屏回调回来之间有 120ms + 截屏
        // 耗时，看门狗这段时间别把刚藏起来的气泡又找回来闪一下。
        screenshotOcr.beginSelection();
        handler.postDelayed(screenshotOcr::captureForSelection, 120);
    }

    @Override
    public void captureActiveWindow() {
        captureBubble.hideMenu();
        chipOverlay.hide();
        captureBubble.setVisible(false);
        String text = WindowTextCollector.collect(getRootInActiveWindow());
        if (text.length() >= 200 && text.split("\n").length >= 4) {
            showOverlay(text, false, null, true);
            return;
        }
        screenshotOcr.captureScreenAndOcr();
    }

    @Override
    public void readClipboardFromMenu() {
        captureBubble.hideMenu();
        clipboardReader.readFromMenu();
    }

    @Override
    public void onBubbleDisabled() {
        state.selectionOcrToken++;
    }

    // ---- ChipOverlay.Host / OverlayPanel.Host / ScreenshotOcr.Host 共享 ----
    @Override
    public SelectionState state() {
        return state;
    }

    @Override
    public void restoreCaptureBubble() {
        captureBubble.restore(captureOff());
    }

    @Override
    public void removeSelectionLayer() {
        screenshotOcr.removeSelectionLayer();
    }

    @Override
    public WindowManager.LayoutParams captureParams() {
        return captureBubble == null ? null : captureBubble.params();
    }

    @Override
    public void hideChip() {
        chipOverlay.hide();
    }

    public void openPanel(boolean ask) {
        String text = state.selectedText;
        Rect bounds = state.selectedBounds == null ? null : new Rect(state.selectedBounds);
        if (text.isEmpty()) {
            return;
        }
        state.lastPanelText = text;
        state.suppressChip = true;
        chipOverlay.hide();
        showOverlay(text, ask, bounds, false);
    }

    void showOverlay(String text, boolean ask, Rect bounds, boolean capture) {
        overlayPanel.show(text, ask, bounds, capture);
        captureBubble.setVisible(false);
    }

    @Override
    public void onSelectionRecognized(String text, Rect bounds) {
        // 「划」拖选 + OCR 认出文字：用户主动的手势，直接弹，不受
        // dismissed 冷却期限制（先清掉旧的 dismissed 记录）。
        state.dismissedText = "";
        state.dismissedBounds = null;
        state.setSelected(text, bounds);
        state.lastShownText = text;
        state.lastShownBounds = bounds == null ? null : new Rect(bounds);
        chipOverlay.show();
        restoreCaptureBubble();
    }

    @Override
    public void onCaptureRecognized(String text) {
        showOverlay(text, false, null, true);
    }

    @Override
    public void onInterrupt() {
        chipOverlay.hide();
    }

    @Override
    public void onDestroy() {
        connected = false;
        instance = null;
        state.selectionOcrToken++;
        handler.removeCallbacks(periodicScanRunnable);
        handler.removeCallbacks(bubbleWatchdogRunnable);
        handler.removeCallbacks(scanRunnable);
        clipboardReader.stop();
        screenshotOcr.removeSelectionLayer();
        overlayPanel.destroy();
        chipOverlay.hide();
        screenshotOcr.hideBusy();
        captureBubble.hideMenu();
        captureBubble.remove();
        super.onDestroy();
    }
}
