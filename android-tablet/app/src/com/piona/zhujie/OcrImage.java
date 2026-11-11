package com.piona.zhujie;

import android.graphics.Bitmap;
import android.graphics.Rect;

import java.io.ByteArrayOutputStream;

/**
 * 从 SelectionService 抽出的截图裁剪/缩放/JPEG 编码。
 * 原来两处（划选 OCR 用 88 质量、整页 OCR 用 82 质量）各写一遍缩放逻辑，
 * 现在收敛到这里；质量参数保留调用方原值，行为不变。
 */
public final class OcrImage {
    public static final int MAX_SIDE = 1600;

    private OcrImage() {
    }

    /** 把选区裁出来并按最长边 1600 缩放；返回的新图由调用方负责 recycle。 */
    public static Bitmap cropAndScale(Bitmap source, Rect rect) {
        Rect safe = new Rect(
                Math.max(0, rect.left),
                Math.max(0, rect.top),
                Math.min(source.getWidth(), rect.right),
                Math.min(source.getHeight(), rect.bottom));
        if (safe.width() < 2 || safe.height() < 2) {
            return null;
        }
        Bitmap crop = Bitmap.createBitmap(source, safe.left, safe.top,
                safe.width(), safe.height());
        return scaleToMax(crop, true);
    }

    /** 整图按最长边缩放；不超限时原样返回（不复制）。 */
    public static Bitmap scaleToMax(Bitmap source) {
        return scaleToMax(source, false);
    }

    private static Bitmap scaleToMax(Bitmap source, boolean recycleInput) {
        int width = source.getWidth();
        int height = source.getHeight();
        int max = Math.max(width, height);
        if (max <= MAX_SIDE) {
            return source;
        }
        float scale = (float) MAX_SIDE / max;
        Bitmap scaled = Bitmap.createScaledBitmap(source,
                Math.max(1, Math.round(width * scale)),
                Math.max(1, Math.round(height * scale)), true);
        if (recycleInput) {
            source.recycle();
        }
        return scaled;
    }

    public static byte[] toJpeg(Bitmap bitmap, int quality) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output);
        return output.toByteArray();
    }
}
