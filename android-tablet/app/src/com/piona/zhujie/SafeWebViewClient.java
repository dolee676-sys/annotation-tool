package com.piona.zhujie;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 只信任本地 asset 页面。http/https 交给系统浏览器（不带桥），
 * 其余 scheme（content/data/intent/javascript 等）一律拒绝，
 * 防止远程页面在注入 AndroidBridge 的 WebView 中打开。
 */
public class SafeWebViewClient extends WebViewClient {
    private final Context context;

    public SafeWebViewClient(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return handle(request.getUrl().toString());
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return handle(url);
    }

    private boolean handle(String url) {
        if (url == null) {
            return true;
        }
        if (url.startsWith("file:///android_asset/")) {
            return false;
        }
        if (url.startsWith("http://") || url.startsWith("https://")) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            } catch (Exception ignored) {
            }
            return true;
        }
        return true;
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        handler.cancel();
    }
}