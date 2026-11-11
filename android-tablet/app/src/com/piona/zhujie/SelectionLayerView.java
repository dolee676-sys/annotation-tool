package com.piona.zhujie;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;

public class SelectionLayerView extends View {
    public interface Listener {
        void onSelected(Rect bitmapRect, Rect screenRect);

        void onCancel();
    }

    private final Bitmap bitmap;
    private final Listener listener;
    private final Paint bitmapPaint = new Paint(Paint.ANTI_ALIAS_FLAG
            | Paint.FILTER_BITMAP_FLAG);
    private final Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint handlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint hintPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint hintTextPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF dst = new RectF();
    private final RectF selection = new RectF();
    private final RectF hintRect = new RectF();
    private final RectF cancelRect = new RectF();
    private final int[] screenLocation = new int[2];
    private final float density;
    private float startX;
    private float startY;
    private boolean dragging;
    private boolean loading;
    private boolean cancelPressed;

    public SelectionLayerView(Context context, Bitmap bitmap, Listener listener) {
        super(context);
        this.bitmap = bitmap;
        this.listener = listener;
        density = context.getResources().getDisplayMetrics().density;
        setFocusable(true);
        setFocusableInTouchMode(true);
        setBackgroundColor(Color.BLACK);

        fillPaint.setColor(0x339A4B16);
        borderPaint.setStyle(Paint.Style.STROKE);
        borderPaint.setStrokeWidth(dp(2));
        borderPaint.setColor(0xFF9A4B16);
        handlePaint.setStyle(Paint.Style.FILL);
        handlePaint.setColor(0xFF9A4B16);
        hintPaint.setColor(0xE62A2723);
        hintTextPaint.setColor(0xFFF6F2EA);
        hintTextPaint.setTextSize(dp(13));
        hintTextPaint.setTypeface(Typeface.DEFAULT_BOLD);
        hintTextPaint.setTextAlign(Paint.Align.CENTER);
    }

    public Bitmap getBitmap() {
        return bitmap;
    }

    public void release() {
        if (!bitmap.isRecycled()) {
            bitmap.recycle();
        }
    }

    private float dp(float value) {
        return value * density;
    }

    @Override
    protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        if (bitmap == null || bitmap.isRecycled()) {
            return;
        }
        float scale = Math.min(
                (float) width / bitmap.getWidth(),
                (float) height / bitmap.getHeight());
        float drawWidth = bitmap.getWidth() * scale;
        float drawHeight = bitmap.getHeight() * scale;
        float left = (width - drawWidth) / 2f;
        float top = (height - drawHeight) / 2f;
        dst.set(left, top, left + drawWidth, top + drawHeight);

        float hintWidth = Math.min(width - dp(32), dp(230));
        float hintHeight = dp(38);
        hintRect.set(
                (width - hintWidth) / 2f,
                Math.max(dp(44), dst.top + dp(20)),
                (width + hintWidth) / 2f,
                Math.max(dp(44), dst.top + dp(20)) + hintHeight);

        float cancelWidth = dp(88);
        float cancelHeight = dp(40);
        float cancelBottom = height - dp(88);
        cancelRect.set(
                (width - cancelWidth) / 2f,
                cancelBottom - cancelHeight,
                (width + cancelWidth) / 2f,
                cancelBottom);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawColor(Color.BLACK);
        if (bitmap == null || bitmap.isRecycled()) {
            return;
        }
        canvas.drawBitmap(bitmap, null, dst, bitmapPaint);
        if (!selection.isEmpty()) {
            canvas.drawRect(selection, fillPaint);
            canvas.drawRect(selection, borderPaint);
            drawHandles(canvas);
        }
        drawHint(canvas);
        drawCancel(canvas);
        if (loading && !selection.isEmpty()) {
            drawLoading(canvas);
        }
    }

    private void drawHandles(Canvas canvas) {
        float radius = dp(4);
        canvas.drawCircle(selection.left, selection.top, radius, handlePaint);
        canvas.drawCircle(selection.right, selection.top, radius, handlePaint);
        canvas.drawCircle(selection.left, selection.bottom, radius, handlePaint);
        canvas.drawCircle(selection.right, selection.bottom, radius, handlePaint);
    }

    private void drawHint(Canvas canvas) {
        canvas.drawRoundRect(hintRect, dp(19), dp(19), hintPaint);
        float centerY = hintRect.centerY()
                - (hintTextPaint.ascent() + hintTextPaint.descent()) / 2f;
        canvas.drawText("拖选文字，松手识别", hintRect.centerX(), centerY,
                hintTextPaint);
    }

    private void drawCancel(Canvas canvas) {
        hintPaint.setColor(cancelPressed ? 0xFFA02C22 : 0xE62A2723);
        canvas.drawRoundRect(cancelRect, dp(20), dp(20), hintPaint);
        hintPaint.setColor(0xE62A2723);
        float centerY = cancelRect.centerY()
                - (hintTextPaint.ascent() + hintTextPaint.descent()) / 2f;
        canvas.drawText("取消", cancelRect.centerX(), centerY, hintTextPaint);
    }

    private void drawLoading(Canvas canvas) {
        String label = "识别中…";
        float textWidth = hintTextPaint.measureText(label);
        float padding = dp(14);
        float height = dp(32);
        float centerX = selection.centerX();
        float top = selection.top - height - dp(8);
        if (top < dst.top + dp(8)) {
            top = selection.bottom + dp(8);
        }
        RectF box = new RectF(
                centerX - textWidth / 2f - padding,
                top,
                centerX + textWidth / 2f + padding,
                top + height);
        canvas.drawRoundRect(box, dp(16), dp(16), hintPaint);
        float centerY = box.centerY()
                - (hintTextPaint.ascent() + hintTextPaint.descent()) / 2f;
        canvas.drawText(label, centerX, centerY, hintTextPaint);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (loading) {
            return true;
        }
        float x = event.getX();
        float y = event.getY();
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                if (cancelRect.contains(x, y)) {
                    cancelPressed = true;
                    invalidate();
                    return true;
                }
                if (!dst.contains(x, y)) {
                    return true;
                }
                dragging = true;
                cancelPressed = false;
                startX = clampX(x);
                startY = clampY(y);
                selection.set(startX, startY, startX, startY);
                invalidate();
                return true;
            case MotionEvent.ACTION_MOVE:
                if (cancelPressed) {
                    if (!cancelRect.contains(x, y)) {
                        cancelPressed = false;
                        invalidate();
                    }
                    return true;
                }
                if (!dragging) {
                    return true;
                }
                float currentX = clampX(x);
                float currentY = clampY(y);
                selection.set(
                        Math.min(startX, currentX),
                        Math.min(startY, currentY),
                        Math.max(startX, currentX),
                        Math.max(startY, currentY));
                invalidate();
                return true;
            case MotionEvent.ACTION_UP:
                if (cancelPressed) {
                    cancelPressed = false;
                    if (cancelRect.contains(x, y)) {
                        listener.onCancel();
                    }
                    invalidate();
                    return true;
                }
                if (!dragging) {
                    return true;
                }
                dragging = false;
                if (selection.width() < dp(10) || selection.height() < dp(10)) {
                    selection.setEmpty();
                    invalidate();
                    return true;
                }
                select();
                return true;
            case MotionEvent.ACTION_CANCEL:
                dragging = false;
                cancelPressed = false;
                selection.setEmpty();
                invalidate();
                return true;
            default:
                return true;
        }
    }

    private void select() {
        if (bitmap == null || bitmap.isRecycled()) {
            listener.onCancel();
            return;
        }
        loading = true;
        invalidate();
        getLocationOnScreen(screenLocation);
        float scaleX = bitmap.getWidth() / dst.width();
        float scaleY = bitmap.getHeight() / dst.height();
        int left = Math.round((selection.left - dst.left) * scaleX);
        int top = Math.round((selection.top - dst.top) * scaleY);
        int right = Math.round((selection.right - dst.left) * scaleX);
        int bottom = Math.round((selection.bottom - dst.top) * scaleY);
        left = Math.max(0, Math.min(left, bitmap.getWidth() - 1));
        top = Math.max(0, Math.min(top, bitmap.getHeight() - 1));
        right = Math.max(left + 1, Math.min(right, bitmap.getWidth()));
        bottom = Math.max(top + 1, Math.min(bottom, bitmap.getHeight()));
        Rect bitmapRect = new Rect(left, top, right, bottom);
        Rect screenRect = new Rect(
                Math.round(selection.left) + screenLocation[0],
                Math.round(selection.top) + screenLocation[1],
                Math.round(selection.right) + screenLocation[0],
                Math.round(selection.bottom) + screenLocation[1]);
        listener.onSelected(bitmapRect, screenRect);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (!loading
                && (keyCode == KeyEvent.KEYCODE_BACK
                || keyCode == KeyEvent.KEYCODE_ESCAPE)) {
            listener.onCancel();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private float clampX(float x) {
        return Math.max(dst.left, Math.min(x, dst.right));
    }

    private float clampY(float y) {
        return Math.max(dst.top, Math.min(y, dst.bottom));
    }
}