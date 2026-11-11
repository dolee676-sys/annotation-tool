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

    /** 面板里有文字被选中时置 true，外部点按不再关面板（否则点系统复制菜单会先关面板）。 */
    public interface SelectionAction {
        void setSelectionActive(boolean active);
    }

    private final Context context;
    private final WebView web;
    private final String text;
    private final boolean askMode;
    private final Runnable closeAction;
    private final PanelMover mover;
    private final PinnedAction pinnedAction;
    private final SelectionAction selectionAction;
    private final Handler main = new Handler(Looper.getMainLooper());

    public OverlayBridge(Context context, WebView web, String text, boolean askMode,
                         Runnable closeAction, PanelMover mover, PinnedAction pinnedAction,
                         SelectionAction selectionAction) {
        this.context = context;
        this.web = web;
        this.text = text == null ? "" : text;
        this.askMode = askMode;
        this.closeAction = closeAction;
        this.mover = mover;
        this.pinnedAction = pinnedAction;
        this.selectionAction = selectionAction;
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
        Store.appendSync(context, "history", json, 500);
    }

    @JavascriptInterface
    public String getFavorites() {
        return Store.array(context, "favorites").toString();
    }

    @JavascriptInterface
    public void addFavorite(String json) {
        Store.appendSync(context, "favorites", json, 200);
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
        Store.appendSync(context, "usage", json, 1000);
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

    /**
     * 复制改同步返回 "true"/"false"：原来是 main.post 里写剪贴板、无返回值，
     * JS 不管写没写成都 toast“已复制。”，个别 ROM 后台写剪贴板抛异常时
     * 用户看到成功、实际什么都没复制。同步写在桥接线程上做（Binder 调用，
     * 不需要主线程），成功才返回 "true"，前端按返回值决定 toast、失败时
     * 再试 navigator.clipboard。
     */
    @JavascriptInterface
    public String copy(String value) {
        try {
            ClipboardManager manager =
                    (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
            if (manager == null) {
                return "false";
            }
            manager.setPrimaryClip(ClipData.newPlainText("注解",
                    value == null ? "" : value));
            return "true";
        } catch (Exception ignored) {
            return "false";
        }
    }

    /** 面板内有选区时调用，见 SelectionAction。 */
    @JavascriptInterface
    public void setSelectionActive(boolean active) {
        if (selectionAction != null) {
            selectionAction.setSelectionActive(active);
        }
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