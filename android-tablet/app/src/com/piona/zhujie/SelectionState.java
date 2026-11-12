package com.piona.zhujie;

import android.graphics.Rect;

/**
 * SelectionService 原来散落在 30 多个字段里的可变状态，集中到这里。
 * 各拆分出的类（ClipboardReader / ChipOverlay / ScreenshotOcr 等）
 * 只通过这一个对象读写选中态，服务本身不再到处传零散字段。
 * 字段含义与原来完全一致，只是换了个地方放。
 */
public final class SelectionState {
    public static final int MAX_TEXT = 2000;

    public String selectedText = "";
    public Rect selectedBounds;
    /** 选中所在的整段文字（给面板理解上下文用；可能为空）。 */
    public String selectedContext = "";
    public String dismissedText = "";
    public boolean suppressChip;
    public String lastPanelText = "";
    public long chipShownAt;
    public long chipProtectUntil;
    /** 截屏 OCR 的代次：旋转/新一次划选就 +1，旧回调凭此号作废。 */
    public long selectionOcrToken;
    public long lastSelectionEventAt;
    public long lastSelectionScanAt;

    // ---- chip 乱弹修复（ChipGate 决策用的状态，见 ChipGate）----
    /** chip 上一次展示的那段文字（展示过即记，隐藏也不清）。 */
    public String lastShownText = "";
    public Rect lastShownBounds;
    /** dismiss 发生时的选区位置（与 dismissedText 配对，用于判断是不是同一段）。 */
    public Rect dismissedBounds;
    /** dismiss 发生的时间（毫秒）。 */
    public long dismissedAt;
    /** 最近一次真正选区事件的时间（毫秒，0 表示从未有过）。 */
    public long lastFreshSelectionAt;
    /** 最近一次选区手势的时间（真选区事件 / 长按 / 窗口切换，毫秒）。 */
    public long lastGestureAt;
    /** 最近一次复制信号的时间（点了复制按钮 / 出现“已复制”提示，毫秒）。 */
    public long lastCopySignalAt;
    /** 最近一次任意点按事件的时间（毫秒）。 */
    public long lastClickAt;

    /**
     * 只设选区本身。dismissedText / suppressChip / lastPanelText 由调用方
     * 按原版逻辑显式清理（事件、扫描、剪贴板清，OCR 识别后不清）。
     */
    public void setSelected(String text, Rect bounds) {
        selectedText = text == null ? "" : text;
        if (selectedText.length() > MAX_TEXT) {
            selectedText = selectedText.substring(0, MAX_TEXT);
        }
        selectedBounds = bounds == null ? null : new Rect(bounds);
    }

    public void clearSelection() {
        selectedText = "";
        selectedBounds = null;
        selectedContext = "";
    }

    /**
     * 选区没了（用户点走了、清空了、chip 超时收了）：把当前这段记成
     * dismissed，而不是把 dismissed 清掉——否则下一次扫描又会把它
     * 当成新选区捞出来重弹。空选区时什么都不做。
     */
    public void recordDismissed() {
        if (selectedText == null || selectedText.isEmpty()) {
            return;
        }
        dismissedText = selectedText;
        dismissedBounds = selectedBounds == null ? null : new Rect(selectedBounds);
        dismissedAt = System.currentTimeMillis();
    }
}
