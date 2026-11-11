package com.piona.zhujie;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

public class OverlayBridge {
    public interface PanelMover {
        void move(int dx, int dy);
    }

    public interface PinnedAction {
        void setPinned(boolean pinned);
    }

    private final Context context;
    private final WebView web;
    private final String text;
    private final boolean askMode;
    private final Runnable closeAction;
    private final PanelMover mover;
    private final PinnedAction pinnedAction;
    private final Handler main = new Handler(Looper.getMainLooper());

    public OverlayBridge(Context context, WebView web, String text, boolean askMode,
                         Runnable closeAction, PanelMover mover, PinnedAction pinnedAction) {
        this.context = context;
        this.web = web;
        this.text = text == null ? "" : text;
        this.askMode = askMode;
        this.closeAction = closeAction;
        this.mover = mover;
        this.pinnedAction = pinnedAction;
    }

    @JavascriptInterface
    public String panelInit() {
        JSONObject out = new JSONObject();
        try {
            out.put("mode", askMode ? "ask" : "annotate");
            out.put("text", text);
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    @JavascriptInterface
    public String captureInit() {
        JSONObject out = new JSONObject();
        try {
            out.put("text", text);
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    @JavascriptInterface
    public String getSettings() {
        return Store.get(context, "settings", "");
    }

    @JavascriptInterface
    public void saveSettings(String json) {
        Store.put(context, "settings", json == null ? "" : json);
    }

    @JavascriptInterface
    public String getHistory() {
        return Store.array(context, "history").toString();
    }

    @JavascriptInterface
    public void addHistory(String json) {
        Store.append(context, "history", json, 500);
    }

    @JavascriptInterface
    public String getFavorites() {
        return Store.array(context, "favorites").toString();
    }

    @JavascriptInterface
    public void addFavorite(String json) {
        Store.append(context, "favorites", json, 200);
    }

    @JavascriptInterface
    public void removeFavorite(String id) {
        Store.removeById(context, "favorites", id);
    }

    @JavascriptInterface
    public String getUsage() {
        return Store.array(context, "usage").toString();
    }

    @JavascriptInterface
    public void addUsage(String json) {
        Store.append(context, "usage", json, 1000);
    }

    @JavascriptInterface
    public void clearRecords() {
        Store.clearRecords(context);
    }

    @JavascriptInterface
    public void chat(String requestJson, String callbackId) {
        AiClient.chat(web, requestJson, callbackId);
    }

    @JavascriptInterface
    public void cancel(String callbackId) {
        AiClient.cancel(callbackId);
    }

    @JavascriptInterface
    public void closePanel() {
        main.post(closeAction);
    }

    @JavascriptInterface
    public void movePanel(int dx, int dy) {
        if (mover == null) {
            return;
        }
        main.post(() -> mover.move(dx, dy));
    }

    @JavascriptInterface
    public void setPinned(boolean pinned) {
        if (pinnedAction != null) {
            main.post(() -> pinnedAction.setPinned(pinned));
        }
    }

    @JavascriptInterface
    public void copy(String value) {
        main.post(() -> {
            ClipboardManager manager =
                    (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
            manager.setPrimaryClip(ClipData.newPlainText("注解",
                    value == null ? "" : value));
        });
    }

    @JavascriptInterface
    public void toast(String message) {
        main.post(() -> Toast.makeText(context,
                message == null ? "" : message, Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public void openMain() {
        main.post(() -> {
            closeAction.run();
            try {
                Intent intent = new Intent(context, MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                intent.putExtra("openSettings", true);
                context.startActivity(intent);
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public void openUrl(String url) {
        if (url == null) {
            return;
        }
        String value = url.trim();
        if (!value.startsWith("https://") && !value.startsWith("http://")) {
            return;
        }
        main.post(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(value));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public String getVersion() {
        return "";
    }
}