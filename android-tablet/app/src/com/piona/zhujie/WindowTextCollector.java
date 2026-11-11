package com.piona.zhujie;

import android.view.accessibility.AccessibilityNodeInfo;

import java.util.HashSet;

/**
 * 从 SelectionService 抽出的“整页抓取时收集当前窗口全部文字”。
 * 逻辑未动：递归最深 50 层、总长上限 20000 字、相同文字去重。
 */
public final class WindowTextCollector {
    private static final int MAX_DEPTH = 50;
    private static final int MAX_LENGTH = 20000;

    private WindowTextCollector() {
    }

    /**
     * 从根节点递归收集全部可见文字。
     *
     * 性能注意：原来 getChild() 拿到的节点一个都不回收，整页抓取一次
     * 遍历整棵树，全是 native 句柄泄漏；现在父节点负责回收自己展开的
     * 子节点，root 由本函数在 finally 里回收（Hit 不持有节点，只有
     * 文字的拷贝，回收安全）。
     */
    public static String collect(AccessibilityNodeInfo root) {
        if (root == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        try {
            collectNode(root, builder, new HashSet<String>(), 0);
        } finally {
            try {
                root.recycle();
            } catch (Exception ignored) {
            }
        }
        return builder.toString().trim();
    }

    private static void collectNode(AccessibilityNodeInfo node, StringBuilder builder,
                                    HashSet<String> seen, int depth) {
        if (node == null || depth > MAX_DEPTH || builder.length() > MAX_LENGTH) {
            return;
        }
        CharSequence text = node.getText();
        if (text != null) {
            String value = text.toString().trim();
            if (!value.isEmpty() && value.length() <= MAX_LENGTH && seen.add(value)) {
                builder.append(value).append('\n');
            }
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) {
                continue;
            }
            try {
                collectNode(child, builder, seen, depth + 1);
            } finally {
                try {
                    child.recycle();
                } catch (Exception ignored) {
                }
            }
        }
    }
}
