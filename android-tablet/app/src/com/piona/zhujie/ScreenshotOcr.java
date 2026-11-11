package com.piona.zhujie;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.Handler;
import android.util.Base64;
import android.view.Display;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * 从 SelectionService 抽出的截屏取词 / 整页 OCR。
 *
 * 行为未动：划选（截屏 → 拖选层 → 裁剪 → Qwen-VL 识别 → 弹 chip）、
 * 整页抓取（先收窗口文字，够 200 字/4 行直接开面板，否则截屏 OCR）。
 * 图片缩放/JPEG 编码已收到 OcrImage；OCR 代次（selectionOcrToken）
 * 仍由 SelectionState 管，旋转/新划选就 +1，旧回调凭此号作废。
 */
public class ScreenshotOcr {
    public interface Host {
        void onSelectionRecognized(String text, Rect bounds);

        /** 整页 OCR 认出文字后直接开面板（capture=true）。 */
        void onCaptureRecognized(String text);

        void restoreCaptureBubble();

        void removeSelectionLayer();

        SelectionState state();
    }

    private final AccessibilityService service;
    private final Handler handler;
    private final WindowManager windowManager;
    private final Host host;

    private SelectionLayerView selectionLayer;
    private WindowManager.LayoutParams selectionLayerParams;
    private TextView busyView;
    private WindowManager.LayoutParams busyParams;
    /**
     * 截屏看门狗：takeScreenshot 的回调在个别机型/状态下可能一直不回
     * （窗口切换中途、上一张截屏还在处理），原来没有任何超时——回调
     * 不回，气泡就永远藏着、截图层也永远不出现，Rick 看到的就是“点
     * 了划拉不出截图框、气泡还消失了”。4 秒没回就当失败，toast + 恢
     * 复气泡，让他能马上重划。代数用来防旧回调/旧超时串到新一次划选。
     */
    private static final long SCREENSHOT_TIMEOUT_MS = 4000;
    private long screenshotGeneration;
    private Runnable screenshotTimeoutRunnable;
    /** 刚点划、正在等截屏回调：气泡看门狗这段时间别把气泡找回来闪一下。 */
    private boolean selectionPending;

    public ScreenshotOcr(AccessibilityService service, Handler handler,
                         WindowManager windowManager, Host host) {
        this.service = service;
        this.handler = handler;
        this.windowManager = windowManager;
        this.host = host;
    }

    /** 划选入口：截屏后显示拖选层；失败时 toast，不静默。 */
    public void captureForSelection() {
        if (!ocrEnabled()) {
            failSelection("截图识图已关闭，可在设置→悬浮取词里开启。");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            failSelection("当前系统不支持截屏取词。");
            return;
        }
        selectionPending = true;
        final long generation = ++screenshotGeneration;
        if (screenshotTimeoutRunnable != null) {
            handler.removeCallbacks(screenshotTimeoutRunnable);
        }
        screenshotTimeoutRunnable = () -> {
            if (generation == screenshotGeneration && selectionLayer == null) {
                failSelection("截屏超时，请重试。");
            }
        };
        handler.postDelayed(screenshotTimeoutRunnable, SCREENSHOT_TIMEOUT_MS);
        try {
            service.takeScreenshot(Display.DEFAULT_DISPLAY, service.getMainExecutor(),
                    new AccessibilityService.TakeScreenshotCallback() {
                        @Override
                        public void onSuccess(AccessibilityService.ScreenshotResult result) {
                            disarmScreenshotTimeout();
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
                            disarmScreenshotTimeout();
                            failSelection("截屏失败（" + errorCode + "）。");
                        }
                    });
        } catch (Exception exception) {
            disarmScreenshotTimeout();
            failSelection("截屏失败。");
        }
    }

    private void disarmScreenshotTimeout() {
        if (screenshotTimeoutRunnable != null) {
            handler.removeCallbacks(screenshotTimeoutRunnable);
        }
    }

    /** 点划后、截屏回调回来前：气泡看门狗别在这段时间把气泡找回来。 */
    public void beginSelection() {
        selectionPending = true;
    }

    public boolean isSelectionPending() {
        return selectionPending;
    }

    public boolean isSelectionLayerShowing() {
        return selectionLayer != null && selectionLayer.getParent() != null;
    }

    private void showSelectionLayer(Bitmap bitmap) {
        if (windowManager == null) {
            selectionPending = false;
            disarmScreenshotTimeout();
            bitmap.recycle();
            host.restoreCaptureBubble();
            return;
        }
        removeSelectionLayer();
        SelectionLayerView layer = new SelectionLayerView(service, bitmap,
                new SelectionLayerView.Listener() {
                    @Override
                    public void onSelected(Rect bitmapRect, Rect screenRect) {
                        runSelectionOcr(bitmapRect, screenRect);
                    }

                    @Override
                    public void onCancel() {
                        removeSelectionLayer();
                        host.restoreCaptureBubble();
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
            host.restoreCaptureBubble();
            Toast.makeText(service, "无法显示划词层。", Toast.LENGTH_LONG).show();
        }
        selectionPending = false;
        disarmScreenshotTimeout();
    }

    private void runSelectionOcr(Rect bitmapRect, Rect screenRect) {
        SelectionLayerView layer = selectionLayer;
        if (layer == null) {
            // 层已经没了（旋转/新划选把它撤了）还走到这里：原来直接静默
            // return，气泡也不恢复——气泡就这么丢了。先把气泡找回来。
            host.restoreCaptureBubble();
            return;
        }
        Bitmap source = layer.getBitmap();
        if (source == null || source.isRecycled()) {
            failSelection("截屏已失效，请重划一次。");
            return;
        }
        Bitmap crop = OcrImage.cropAndScale(source, bitmapRect);
        if (crop == null) {
            failSelection("选区太小，请重划一次。");
            return;
        }
        removeSelectionLayer();
        showBusy();
        host.restoreCaptureBubble();
        long token = ++host.state().selectionOcrToken;
        new Thread(() -> {
            try {
                byte[] jpeg = OcrImage.toJpeg(crop, 88);
                crop.recycle();
                String[] config = ocrConfig();
                if (config == null || config[1].isEmpty()) {
                    handler.post(() -> {
                        if (token == host.state().selectionOcrToken) {
                            failSelection("识图需要通义千问 Key：先去设置里填好。");
                        }
                    });
                    return;
                }
                String base64 = Base64.encodeToString(jpeg, Base64.NO_WRAP);
                ScreenOcr.recognize(config[0], config[1], base64, (text, error) -> {
                    if (error != null) {
                        handler.post(() -> {
                            if (token == host.state().selectionOcrToken) {
                                failSelection(error);
                            }
                        });
                        return;
                    }
                    handler.post(() -> {
                        if (token != host.state().selectionOcrToken) {
                            return;
                        }
                        String cleaned = text == null ? "" : text.trim();
                        if (cleaned.isEmpty()) {
                            failSelection("没有识别到文字，请重划一次。");
                            return;
                        }
                        if (cleaned.length() > SelectionState.MAX_TEXT) {
                            cleaned = cleaned.substring(0, SelectionState.MAX_TEXT);
                        }
                        Rect bounds = new Rect(screenRect);
                        int screenHeight = service.getResources()
                                .getDisplayMetrics().heightPixels;
                        if (bounds.width() <= 0 || bounds.height() <= 0
                                || bounds.bottom <= 0 || bounds.top >= screenHeight) {
                            bounds = null;
                        }
                        hideBusy();
                        host.onSelectionRecognized(cleaned, bounds);
                    });
                });
            } catch (Exception exception) {
                handler.post(() -> {
                    if (token == host.state().selectionOcrToken) {
                        failSelection("识别选区失败。");
                    }
                });
            }
        }, "zhujie-selection-ocr").start();
    }

    private void failSelection(String message) {
        selectionPending = false;
        disarmScreenshotTimeout();
        hideBusy();
        removeSelectionLayer();
        host.restoreCaptureBubble();
        if (message != null && !message.isEmpty()) {
            Toast.makeText(service, message, Toast.LENGTH_LONG).show();
        }
    }

    public void removeSelectionLayer() {
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

    /** 整页抓取：截屏 → OCR → 直接开面板。 */
    public void captureScreenAndOcr() {
        if (!ocrEnabled()) {
            failOcr("截图识图已关闭，可在设置→悬浮取词里开启。");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            failOcr("当前系统不支持截屏识别。");
            return;
        }
        try {
            service.takeScreenshot(Display.DEFAULT_DISPLAY, service.getMainExecutor(),
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
            Bitmap scaled = OcrImage.scaleToMax(bitmap);
            byte[] jpeg = OcrImage.toJpeg(scaled, 82);
            if (scaled != bitmap) {
                scaled.recycle();
            }
            bitmap.recycle();
            String base64 = Base64.encodeToString(jpeg, Base64.NO_WRAP);
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
                    host.onCaptureRecognized(text);
                });
            });
        } catch (Exception exception) {
            failOcr("识图失败。");
        }
    }

    public boolean ocrEnabled() {
        try {
            JSONObject settings = new JSONObject(Store.get(service, "settings", ""));
            return settings.optBoolean("ocrEnabled", true);
        } catch (Exception exception) {
            return true;
        }
    }

    /** 识图固定走通义千问 Key（HANDOVER §15 待办：独立识图 Key 入口）。 */
    public String[] ocrConfig() {
        try {
            JSONObject settings = new JSONObject(Store.get(service, "settings", ""));
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

    public void showBusy() {
        if (busyView != null || windowManager == null) {
            return;
        }
        busyView = new TextView(service);
        busyView.setText("识别中…");
        busyView.setTextColor(0xFFF6F2EA);
        busyView.setTextSize(13);
        busyView.setGravity(Gravity.CENTER);
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xE62A2723);
        background.setCornerRadius(UiUtil.dp(service, 12));
        busyView.setBackground(background);
        busyView.setPadding(UiUtil.dp(service, 16), UiUtil.dp(service, 10),
                UiUtil.dp(service, 16), UiUtil.dp(service, 10));
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

    public void hideBusy() {
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
            Toast.makeText(service, message, Toast.LENGTH_LONG).show();
            host.restoreCaptureBubble();
        });
    }

    /** 供服务销毁 / 旋转时调用：作废进行中的 OCR 回调并收起忙碌提示。 */
    public void invalidate() {
        host.state().selectionOcrToken++;
        hideBusy();
        removeSelectionLayer();
    }
}
