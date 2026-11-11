package com.piona.zhujie;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends Activity {
    public static final String EXTRA_CAPTURE_TEXT = "captureText";
    private static final int REQUEST_TEXT_FILE = 41;
    private WebView web;
    private String pendingFileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(0xFFF6F2EA);
        getWindow().setNavigationBarColor(0xFFF6F2EA);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                        | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

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
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setBackgroundColor(0xFFF6F2EA);
        web.setWebViewClient(new SafeWebViewClient(this) {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (getIntent().getBooleanExtra("openSettings", false)) {
                    view.evaluateJavascript("window.__openSettings && window.__openSettings()", null);
                    getIntent().removeExtra("openSettings");
                }
                String capture = getIntent().getStringExtra(EXTRA_CAPTURE_TEXT);
                if (capture != null && !capture.isEmpty()) {
                    view.evaluateJavascript("window.__openCapture && window.__openCapture("
                            + JSONObject.quote(capture) + ")", null);
                    getIntent().removeExtra(EXTRA_CAPTURE_TEXT);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(this, web, "", false), "AndroidBridge");
        Bridge.syncCaptureComponents(this);

        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        web.loadUrl("file:///android_asset/index.html");
    }

    public void pickTextFile(String callbackId) {
        pendingFileCallback = callbackId;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(intent, REQUEST_TEXT_FILE);
        } catch (Exception exception) {
            pendingFileCallback = null;
            Toast.makeText(this, "没有可用的文件选择器。", Toast.LENGTH_SHORT).show();
            emit("window.__filePicked(" + JSONObject.quote(callbackId) + ",null);");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_TEXT_FILE) {
            return;
        }
        String callbackId = pendingFileCallback;
        pendingFileCallback = null;
        if (callbackId == null) {
            return;
        }
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            emit("window.__filePicked(" + JSONObject.quote(callbackId) + ",null);");
            return;
        }
        try {
            Uri uri = data.getData();
            InputStream input = getContentResolver().openInputStream(uri);
            if (input == null) {
                throw new IllegalStateException("empty");
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            int total = 0;
            while ((read = input.read(buffer)) > 0) {
                total += read;
                if (total > 2_000_000) {
                    break;
                }
                output.write(buffer, 0, read);
            }
            input.close();
            String text = output.toString("UTF-8");
            emit("window.__filePicked(" + JSONObject.quote(callbackId) + ","
                    + JSONObject.quote(text) + ");");
        } catch (Exception exception) {
            emit("window.__filePicked(" + JSONObject.quote(callbackId) + ",null);");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getBooleanExtra("openSettings", false)) {
            emit("window.__openSettings && window.__openSettings()");
            intent.removeExtra("openSettings");
        }
        String capture = intent.getStringExtra(EXTRA_CAPTURE_TEXT);
        if (capture != null && !capture.isEmpty()) {
            emit("window.__openCapture && window.__openCapture("
                    + JSONObject.quote(capture) + ")");
            intent.removeExtra(EXTRA_CAPTURE_TEXT);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        emit("window.__refreshAccessibility && window.__refreshAccessibility()");
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(window.__handleBack && window.__handleBack()) ? 1 : 0",
                value -> {
                    if (!"1".equals(value)) {
                        finish();
                    }
                });
    }

    private void emit(String script) {
        if (web == null) {
            return;
        }
        web.post(() -> {
            try {
                web.evaluateJavascript(script, null);
            } catch (Exception ignored) {
            }
        });
    }

    @Override
    protected void onDestroy() {
        AiClient.cancelOwner(web);
        if (web != null) {
            web.removeJavascriptInterface("AndroidBridge");
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
