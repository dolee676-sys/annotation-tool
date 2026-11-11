package com.piona.zhujie;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

public class PanelDragHandle extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float density;

    public PanelDragHandle(Context context) {
        super(context);
        density = context.getResources().getDisplayMetrics().density;
        paint.setColor(0x552A2723);
    }

    private float dp(float value) {
        return value * density;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float centerX = getWidth() / 2f;
        canvas.drawRoundRect(
                centerX - dp(18), dp(12),
                centerX + dp(18), dp(16),
                dp(2), dp(2), paint);
    }
}