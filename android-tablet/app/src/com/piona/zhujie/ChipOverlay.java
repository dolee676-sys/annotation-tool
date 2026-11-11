package com.piona.zhujie;

import android.accessibilityservice.AccessibilityService;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 从 SelectionService 抽出的「注 / 问」小条（chip）。
 * 行为：选中后 120ms 弹出、无操作 {@link ChipGate#AUTO_HIDE_MS} 后自动收起、
 * 点「注/问」进悬浮面板；位置优先贴在选区上方，放不下时贴下方，否则贴右下角。
 * 同一段已在展示时只更新位置、不重置自动隐藏计时（见 {@link #show()}），
 * 否则滚动触发的补漏扫描会一次次续期，小框迟迟不消失。
 */
public class ChipOverlay {
    public interface Host {
        void openPanel(boolean ask);

        void restoreCaptureBubble();

        /** 取词总开关关着时不弹 chip（原版 showChip 的守卫）。 */
        boolean captureOff();

        SelectionState state();
    }

    private final AccessibilityService service;
    private final Handler handler;
    private final WindowManager windowManager;
    private final Host host;

    private LinearLayout chip;
    private WindowManager.LayoutParams chipParams;
    private Runnable showRunnable;
    private Runnable hideRunnable;
    /** 当前正在展示的 chip 对应哪段文字（未展示时为 null）。用于判断要不要重置自动隐藏计时。 */
    private String shownText;

    public ChipOverlay(AccessibilityService service, Handler handler,
                       WindowManager windowManager, Host host) {
        this.service = service;
        this.handler = handler;
        this.windowManager = windowManager;
        this.host = host;
        this.showRunnable = this::show;
        this.hideRunnable = () -> {
            SelectionState state = host.state();
            if (!state.selectedText.isEmpty()) {
                // 超时收起 = 用户没点这段：记成 dismissed（含位置与时间），
                // 否则下一次扫描又会把它当成新选区捞出来重弹。
                state.recordDismissed();
            }
            hide();
            host.restoreCaptureBubble();
        };
    }

    public boolean isShowing() {
        return chip != null && chip.getParent() != null;
    }

    public void showDelayed(long delayMs) {
        handler.removeCallbacks(showRunnable);
        handler.postDelayed(showRunnable, delayMs);
    }

    public void hideDelayed(long delayMs) {
        handler.removeCallbacks(hideRunnable);
        handler.postDelayed(hideRunnable, delayMs);
    }

    public void cancelPending() {
        handler.removeCallbacks(showRunnable);
        handler.removeCallbacks(hideRunnable);
    }

    public void show() {
        SelectionState state = host.state();
        if (state.selectedText.isEmpty() || windowManager == null) {
            return;
        }
        if (host.captureOff()) {
            return;
        }
        // 最后一道防线：调用方都应先过 ChipGate，但万一哪条路漏了，
        // 刚被 dismiss 的同一段文字（冷却期内）在这里也不许弹。
        if (!state.dismissedText.isEmpty()
                && state.dismissedText.equals(state.selectedText)
                && System.currentTimeMillis() - state.dismissedAt
                        < ChipGate.RESELECT_COOLDOWN_MS) {
            Rect dismissedBounds = state.dismissedBounds;
            Rect selectedBounds = state.selectedBounds;
            boolean sameBounds = dismissedBounds == null ? selectedBounds == null
                    : dismissedBounds.equals(selectedBounds);
            if (sameBounds) {
                return;
            }
        }
        // 同一段已在展示（例如滚动后补漏扫描又找到它）：只更新位置，不重置
        // 自动隐藏计时；否则每次滚动都会把计时续满，小框迟迟不消失。
        if (!ChipGate.shouldRearmTimer(shownText, state.selectedText)) {
            updateChipPosition();
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
                Toast.makeText(service, "注/问按钮显示失败，请再划一次。",
                        Toast.LENGTH_LONG).show();
                return;
            }
        }
        shownText = state.selectedText;
        state.chipShownAt = System.currentTimeMillis();
        state.chipProtectUntil = state.chipShownAt + ChipGate.PROTECT_MS;
        handler.removeCallbacks(hideRunnable);
        handler.postDelayed(hideRunnable, ChipGate.AUTO_HIDE_MS);
    }

    private void createChip() {
        chip = new LinearLayout(service);
        chip.setOrientation(LinearLayout.HORIZONTAL);
        chip.setGravity(Gravity.CENTER_VERTICAL);
        chip.setPadding(UiUtil.dp(service, 4), UiUtil.dp(service, 4),
                UiUtil.dp(service, 4), UiUtil.dp(service, 4));
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xFF2A2723);
        background.setCornerRadius(UiUtil.dp(service, 12));
        chip.setBackground(background);
        chip.setElevation(UiUtil.dp(service, 8));

        TextView annotate = makeButton("注");
        TextView ask = makeButton("问");
        annotate.setOnClickListener(view -> host.openPanel(false));
        ask.setOnClickListener(view -> host.openPanel(true));
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
        TextView button = new TextView(service);
        button.setText(label);
        button.setTextColor(0xFFF6F2EA);
        button.setTextSize(14);
        button.setGravity(Gravity.CENTER);
        // 触控高度：上下各 12dp 内边距 + 文字 ≈ 48dp。
        button.setPadding(UiUtil.dp(service, 18), UiUtil.dp(service, 12),
                UiUtil.dp(service, 18), UiUtil.dp(service, 12));
        button.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        return button;
    }

    private void updateChipPosition() {
        if (chip == null || chipParams == null) {
            return;
        }
        SelectionState state = host.state();
        Rect selectedBounds = state.selectedBounds;
        chip.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED);
        int width = chip.getMeasuredWidth();
        int height = chip.getMeasuredHeight();
        int screenWidth = service.getResources().getDisplayMetrics().widthPixels;
        int screenHeight = service.getResources().getDisplayMetrics().heightPixels;
        int x;
        int y;
        if (selectedBounds != null && selectedBounds.height() < screenHeight * 0.72) {
            x = selectedBounds.centerX() - width / 2;
            y = selectedBounds.top - height - UiUtil.dp(service, 10);
            if (y < UiUtil.dp(service, 40)) {
                y = selectedBounds.bottom + UiUtil.dp(service, 10);
            }
        } else {
            x = screenWidth - width - UiUtil.dp(service, 22);
            y = screenHeight - height - UiUtil.dp(service, 150);
        }
        x = Math.max(UiUtil.dp(service, 8), Math.min(x, screenWidth - width - UiUtil.dp(service, 8)));
        y = Math.max(UiUtil.dp(service, 40), Math.min(y, screenHeight - height - UiUtil.dp(service, 24)));
        chipParams.x = x;
        chipParams.y = y;
        if (chip.getParent() != null) {
            try {
                windowManager.updateViewLayout(chip, chipParams);
            } catch (Exception ignored) {
            }
        }
    }

    public void hide() {
        handler.removeCallbacks(showRunnable);
        handler.removeCallbacks(hideRunnable);
        shownText = null;
        host.state().clearSelection();
        if (chip != null && chip.getParent() != null && windowManager != null) {
            try {
                windowManager.removeView(chip);
            } catch (Exception ignored) {
            }
        }
    }
}
