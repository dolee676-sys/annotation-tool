package com.piona.zhujie;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class PanelActivity extends Activity {
    protected WebView web;
    protected Bridge bridge;

    protected boolean isAskMode() {
        return false;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        Window window = getWindow();
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setDimAmount(0.10f);
        setFinishOnTouchOutside(false);

        setupWeb(getIntent());
        applyWindowSize();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        destroyWeb();
        setupWeb(intent);
        applyWindowSize();
    }

    private void setupWeb(Intent intent) {
        CharSequence extra = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        if (extra == null) {
            extra = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        }
        String text = extra == null ? "" : extra.toString();

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setWebViewClient(new SafeWebViewClient(this));
        web.setWebChromeClient(new WebChromeClient());
        bridge = new Bridge(this, web, text, isAskMode());
        web.addJavascriptInterface(bridge, "AndroidBridge");
        web.loadUrl("file:///android_asset/panel.html");

        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void destroyWeb() {
        if (web != null) {
            AiClient.cancelOwner(web);
            web.removeJavascriptInterface("AndroidBridge");
            web.stopLoading();
            web.destroy();
            web = null;
        }
    }

    private void applyWindowSize() {
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int width = Math.min(dp(520), Math.round(metrics.widthPixels * 0.46f));
        int height = Math.min(dp(780), metrics.heightPixels - dp(72));
        Window window = getWindow();
        window.setLayout(width, height);
        window.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
    }

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        applyWindowSize();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        finish();
    }

    @Override
    protected void onDestroy() {
        destroyWeb();
        super.onDestroy();
    }
}
