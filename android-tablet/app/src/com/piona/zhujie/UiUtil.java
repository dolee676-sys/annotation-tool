package com.piona.zhujie;

import android.content.Context;

/** 原来 SelectionService / PanelDragHandle 各写一份的 dp 换算，收敛到这里。 */
public final class UiUtil {
    private UiUtil() {
    }

    public static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }
}
