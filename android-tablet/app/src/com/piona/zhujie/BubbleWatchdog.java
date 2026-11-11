package com.piona.zhujie;

/**
 * “划”气泡自愈看门狗的纯判断（无 Android 依赖，可 JVM 单测）。
 *
 * 背景：0.1.40 上 Rick 遇到气泡“用着用着又消失了”、点了划又拉不出
 * 截图框。逐条链路对照 0.1.38 没找到哪一步改坏了，但隐藏路径多、
 * 任何一条漏恢复都会让气泡丢了且不再回来（enterSelectionMode 藏气
 * 泡 → 截屏回调万一不回，气泡就永远藏着）。所以除了给截屏加超时，
 * 再加一道 1.5 秒一次的看门狗：只要不是“本该藏着”的状态，就把气泡
 * 找回来。
 *
 * “本该藏着”的状态（返回 false，一律不碰气泡）：
 * - 总开关关了；
 * - 用户亲手在长按菜单里点了“关闭划”；
 * - 悬浮面板开着（面板关时会自己恢复气泡）；
 * - 正在拖选（截图层在上面，气泡藏在后面是对的）；
 * - 刚点划、正在等截屏（别让气泡在截图层出现前闪一下）。
 */
public final class BubbleWatchdog {
    private BubbleWatchdog() {
    }

    public static boolean shouldRestore(boolean captureOff, boolean bubbleDisabled,
                                        boolean panelOpen, boolean selectionLayerShowing,
                                        boolean selectionPending) {
        if (captureOff) {
            return false;
        }
        if (bubbleDisabled) {
            return false;
        }
        if (panelOpen) {
            return false;
        }
        if (selectionLayerShowing) {
            return false;
        }
        if (selectionPending) {
            return false;
        }
        return true;
    }
}
