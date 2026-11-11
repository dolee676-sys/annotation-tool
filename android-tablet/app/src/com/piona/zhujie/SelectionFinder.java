package com.piona.zhujie;

import android.graphics.Rect;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.List;
import java.util.Locale;

/**
 * 从 SelectionService 抽出的“在当前窗口里找选中文字”。
 * 原来是 SelectionService 里的 findSelection + SelectionHit，
 * 逻辑一字未动：广度优先遍历、最多 2500 个节点、跳过可编辑节点、
 * 选中区间过大（超过屏高 72%）时丢掉 bounds 只留文字。
 */
public final class SelectionFinder {
    private static final int MAX_VISITED = 2500;

    private SelectionFinder() {
    }

    public static final class Hit {
        public final String text;
        public final Rect bounds;

        public Hit(String text, Rect bounds) {
            this.text = text;
            this.bounds = bounds;
        }
    }

    /**
     * 从无障碍事件里取选区：只认真实的选区区间（开始 &lt; 结束）。
     *
     * 旧版在没有真实区间时还会兜底返回事件文本 / 整段短文本——但对
     * TYPE_VIEW_TEXT_SELECTION_CHANGED 来说，事件文本通常就是节点的
     * 全文，于是“点一下挪光标（开始 == 结束）”“点一下短段落聚焦”
     * 也会被当成选中，chip 莫名其妙弹出来。修掉兜底：没有真实区间
     * 就返回空串，不弹。漏掉的场景由长按触发的扫描补（扫描只认
     * 真实区间，见 findSelection），不会把点按当选中。
     */
    public static String extractSelection(AccessibilityEvent event, AccessibilityNodeInfo source) {
        if (source != null && source.isEditable()) {
            return "";
        }
        if (source != null) {
            CharSequence full = source.getText();
            int start = source.getTextSelectionStart();
            int end = source.getTextSelectionEnd();
            if (full != null && ChipGate.hasRealRange(start, end, full.length())) {
                CharSequence part = full.subSequence(start, end);
                if (part != null && part.toString().trim().length() > 0) {
                    return part.toString();
                }
            }
        }
        return "";
    }

    public static boolean looksLikeCopyClick(AccessibilityEvent event) {
        String label = labelOf(event).toLowerCase(Locale.ROOT);
        if (label.isEmpty()) {
            return false;
        }
        return label.contains("复制") || label.contains("拷贝")
                || label.contains("copy");
    }

    public static boolean looksLikeCopiedNotice(AccessibilityEvent event) {
        String label = labelOf(event).toLowerCase(Locale.ROOT);
        if (label.isEmpty()) {
            return false;
        }
        return label.contains("已复制") || label.contains("复制到剪贴板")
                || label.contains("copied") || label.contains("clipboard");
    }

    public static String labelOf(AccessibilityEvent event) {
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

    private static void appendLabel(StringBuilder builder, CharSequence value) {
        if (value == null) {
            return;
        }
        int length = Math.min(value.length(), 80);
        builder.append(value, 0, length).append(' ');
    }

    /** 选区 bounds：太小或超过半屏高的不要（多半是整页节点误判）。 */
    public static Rect boundsOf(AccessibilityNodeInfo source, int screenHeight) {
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
        if (bounds.height() > screenHeight * 0.5f) {
            return null;
        }
        return bounds;
    }

    /**
     * 从窗口根节点广度优先找第一个真实选区。
     *
     * 性能注意（0.1.39 实测链路上的大头）：
     * 1. 先查选区区间、再拿全文。原来每个节点先 getText()（整段文字
     *    走 Binder 编组回来）再查区间，2500 个节点的树一次扫描就要编组
     *    2500 段全文；现在只对「确实有选区区间」的节点才拿全文，绝大多数
     *    节点只剩两次轻量区间查询。
     * 2. 遍历过的节点及时 recycle。原来 getChild() 拿到的节点一个都没
     *    回收，1.5 秒一次的周期扫描 + 滚动/内容变化触发的扫描长期下来
     *    会堆 native 内存、加重 GC。root 由调用方回收（见调用处），
     *    这里只回收本函数内 poll 出来的非 root 节点与超限后队里剩下的节点。
     */
    public static Hit findSelection(AccessibilityNodeInfo root, int screenHeight) {
        if (root == null) {
            return null;
        }
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < MAX_VISITED) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            try {
                if (node.isEditable()) {
                    continue;
                }
                int start = node.getTextSelectionStart();
                int end = node.getTextSelectionEnd();
                if (start < 0 || end <= start) {
                    // 没有选区区间：不拿全文，直接展开子节点。
                    int count = node.getChildCount();
                    for (int index = 0; index < count; index++) {
                        AccessibilityNodeInfo child = node.getChild(index);
                        if (child != null) {
                            queue.add(child);
                        }
                    }
                    continue;
                }
                CharSequence text = node.getText();
                if (text != null && start < text.length()) {
                    int stop = Math.min(end, text.length());
                    String value = text.subSequence(start, stop).toString().trim();
                    if (!value.isEmpty()) {
                        Rect bounds = new Rect();
                        node.getBoundsInScreen(bounds);
                        if (bounds.width() <= 0 || bounds.height() <= 0
                                || bounds.height() > screenHeight * 0.72f) {
                            bounds = null;
                        }
                        recycleQueue(queue, root);
                        return new Hit(value, bounds);
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
            } finally {
                if (node != root) {
                    try {
                        node.recycle();
                    } catch (Exception ignored) {
                    }
                }
            }
        }
        recycleQueue(queue, root);
        return null;
    }

    /** 回收队列里还没轮到的节点（命中提前返回与超限退出两条路都要走）。 */
    private static void recycleQueue(ArrayDeque<AccessibilityNodeInfo> queue,
                                     AccessibilityNodeInfo root) {
        AccessibilityNodeInfo leftover;
        while ((leftover = queue.poll()) != null) {
            if (leftover != root) {
                try {
                    leftover.recycle();
                } catch (Exception ignored) {
                }
            }
        }
    }
}
