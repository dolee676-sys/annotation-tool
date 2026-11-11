package com.piona.zhujie;

/**
 * 「注 / 问」chip 到底弹不弹，唯一的判断入口（纯函数，不依赖 Android，可单测）。
 *
 * 用户规则：只有两种情况可以弹——(a) 光标真正选中了文字；(b) 用户主动用「划」
 * 拖选并 OCR 识别出文字。点一下、窗口变化、旧选区重扫、应用自己写剪贴板，
 * 都不许弹。
 *
 * 本类只做判断、不读写任何 Android 状态。调用方（SelectionService）每次把
 * 快照（Snapshot）传进来，本类返回能不能弹；状态的写入仍由调用方做。
 *
 * 三个入口的区别：
 * - shouldShowSelection：无障碍事件里拿到真正的选区（调用方已确认是真实选区
 *   区间，见 {@link #hasRealRange}）。只要文字是新的、没被刚 dismissed，就弹。
 * - shouldShowScan：周期扫描 / 窗口变化扫描的补漏。只在“最近刚有选区手势”
 *   （真选区事件、长按、窗口切换）时才允许弹——没有手势的扫描发现的选区，
 *   默认是旧选区残留，不弹。
 * - shouldShowClipboard：剪贴板变化。只在“最近刚有用户复制动作”
 *   （点了复制按钮、出现“已复制”提示、或任意点按）时才允许弹——应用后台
 *   自己写剪贴板，不弹。菜单里用户主动点的“读剪贴板”不走这里（直接放行）。
 *
 * “刚 dismissed 又重弹”的防抖：同一段文字 + 同一个位置，在
 * RESELECT_COOLDOWN_MS 内不许再弹；位置变了、或过了冷却期，视为用户
 * 重新选中，放行。
 */
public final class ChipGate {
    /** 扫描补漏的手势有效期：超过这么久没有选区手势，扫描不再弹 chip。 */
    public static final long GESTURE_WINDOW_MS = 5000;
    /** 同一段文字被 dismiss 后，冷却期内不许再弹。 */
    public static final long RESELECT_COOLDOWN_MS = 5000;
    /** 剪贴板变化后，用户复制动作的有效期。 */
    public static final long CLIPBOARD_SIGNAL_WINDOW_MS = 3000;
    /**
     * 「注 / 问」无操作自动消失的时长。原来 8000ms：选中一段文字后小框要在
     * 屏幕上挂 8 秒才消失，用户体感就是“好一会才能消失”。
     */
    public static final long AUTO_HIDE_MS = 3000;
    /**
     * chip 刚弹出后的保护期：这段时间内的“选区已清空”事件很可能是选区事件流
     * 的瞬时抖动，不收小框。原来 6000ms：选中后 6 秒内点走，空选区事件直接
     * 被拦掉，小框只能等 8 秒自动隐藏——这是“点走也不消失”的另一半原因。
     * 1200ms 足够盖住 120ms 的弹出延迟与事件抖动。
     */
    public static final long PROTECT_MS = 1200;

    private ChipGate() {
    }

    /**
     * 同一段文字已经在展示时，不要重置自动隐藏计时：只更新位置即可。
     * 否则滚动 / 内容变化触发的补漏扫描（选区 bounds 跟着滚动变了）会一次次
     * 把 3 秒计时重置，小框迟迟不消失。换了一段文字、或小框没在展示时，返回
     * true（重新计时）。
     */
    public static boolean shouldRearmTimer(String shownText, String selectedText) {
        if (shownText == null || shownText.isEmpty()) {
            return true;
        }
        if (selectedText == null || selectedText.isEmpty()) {
            return true;
        }
        return !shownText.equals(selectedText);
    }

    /** 选区位置（纯数据，不依赖 android.graphics.Rect，方便单测）。 */
    public static final class Bounds {
        public final int left;
        public final int top;
        public final int right;
        public final int bottom;

        public Bounds(int left, int top, int right, int bottom) {
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }

        public static Bounds of(int left, int top, int right, int bottom) {
            return new Bounds(left, top, right, bottom);
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof Bounds)) {
                return false;
            }
            Bounds that = (Bounds) other;
            return left == that.left && top == that.top
                    && right == that.right && bottom == that.bottom;
        }

        @Override
        public int hashCode() {
            int result = left;
            result = 31 * result + top;
            result = 31 * result + right;
            result = 31 * result + bottom;
            return result;
        }
    }

    /** 调用方每次现拼的快照：全部是值类型，本类只读不写。 */
    public static final class Snapshot {
        /** chip 当前正在展示的那段文字（未展示时为空串）。 */
        public String shownText = "";
        public Bounds shownBounds;
        /** 用户刚 dismiss / 选区刚清空的那段文字（没有时为空串）。 */
        public String dismissedText = "";
        public Bounds dismissedBounds;
        /** dismiss 发生的时间（毫秒）。 */
        public long dismissedAt;
        /** 最近一次真正选区事件的时间（毫秒，0 表示从未有过）。 */
        public long lastFreshSelectionAt;
        /** 最近一次选区手势的时间（真选区事件 / 长按 / 窗口切换，毫秒）。 */
        public long lastGestureAt;
        /** 面板正开着时为 true，此时同段文字不许再弹 chip。 */
        public boolean suppressChip;
        /** 面板里正在展示的那段文字。 */
        public String panelText = "";
        /** chip 当前是否正在屏幕上展示。 */
        public boolean chipShowing;
        /** 当前已选中的文字（用于剪贴板去重）。 */
        public String currentText = "";
    }

    /**
     * 是不是真正的选区区间：开始 &lt; 结束，且落在文本长度内。
     * 光标只是挪了一下（开始 == 结束）、或没有选区（开始 &lt; 0），都不是选区。
     */
    public static boolean hasRealRange(int start, int end, int length) {
        return start >= 0 && end > start && end <= length && start < length;
    }

    private static boolean isBlank(String text) {
        return text == null || text.trim().isEmpty();
    }

    private static boolean sameBounds(Bounds a, Bounds b) {
        if (a == null || b == null) {
            return a == b;
        }
        return a.equals(b);
    }

    /** 这段文字是不是“刚被 dismiss、且还在冷却期内的同一段”？ */
    private static boolean isCoolingDown(String text, Bounds bounds, long now, Snapshot s) {
        if (s.dismissedText == null || s.dismissedText.isEmpty()) {
            return false;
        }
        if (!s.dismissedText.equals(text)) {
            return false;
        }
        if (!sameBounds(bounds, s.dismissedBounds)) {
            return false;
        }
        return now - s.dismissedAt < RESELECT_COOLDOWN_MS;
    }

    private static boolean isPanelSuppressed(String text, Snapshot s) {
        return s.suppressChip && s.panelText != null && s.panelText.equals(text);
    }

    private static boolean isAlreadyShowing(String text, Bounds bounds, Snapshot s) {
        return s.chipShowing && s.shownText != null && s.shownText.equals(text)
                && sameBounds(bounds, s.shownBounds);
    }

    /** (a) 真选区事件：文字新、没被刚 dismiss、面板没压着、没在展示，就弹。 */
    public static boolean shouldShowSelection(String text, Bounds bounds, long now, Snapshot s) {
        if (isBlank(text)) {
            return false;
        }
        String cleaned = text.trim();
        if (isPanelSuppressed(cleaned, s)) {
            return false;
        }
        if (isCoolingDown(cleaned, bounds, now, s)) {
            return false;
        }
        if (isAlreadyShowing(cleaned, bounds, s)) {
            return false;
        }
        return true;
    }

    /**
     * 补漏扫描：除真选区事件的全部条件外，还要求最近有选区手势。
     * 没有手势的扫描发现的选区，一律视为旧选区残留，不弹。
     */
    public static boolean shouldShowScan(String text, Bounds bounds, long now, Snapshot s) {
        if (!shouldShowSelection(text, bounds, now, s)) {
            return false;
        }
        // 补漏扫描发现的还是正在展示的那段文字（位置可能跟着滚动变了），不许
        // 再弹：否则每次滚动 / 内容变化都会重新触发 show()，把自动隐藏计时
        // 重置一遍，小框迟迟不消失。真重新选一段会走选区事件那条路，不受影响。
        if (s.chipShowing && s.shownText != null && s.shownText.equals(text.trim())) {
            return false;
        }
        if (s.lastGestureAt <= 0 || now - s.lastGestureAt > GESTURE_WINDOW_MS) {
            return false;
        }
        return true;
    }

    /**
     * 剪贴板变化：除通用条件外，还要求最近有用户复制动作。
     * lastSignalAt 由调用方传最近的“复制信号或任意点按”的时间；
     * 手动“读剪贴板”请直接传 now（用户主动，不设限）。
     */
    public static boolean shouldShowClipboard(String text, long now, Snapshot s,
                                              long lastSignalAt) {
        if (isBlank(text)) {
            return false;
        }
        String cleaned = text.trim();
        if (isPanelSuppressed(cleaned, s)) {
            return false;
        }
        if (s.chipShowing && s.currentText != null && s.currentText.equals(cleaned)) {
            return false;
        }
        if (lastSignalAt <= 0 || now - lastSignalAt > CLIPBOARD_SIGNAL_WINDOW_MS) {
            return false;
        }
        return true;
    }
}
