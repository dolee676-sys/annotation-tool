package com.piona.zhujie;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.List;

public class Bridge {
    private final Activity activity;
    private final WebView web;
    private final String panelText;
    private final boolean panelAsk;

    public Bridge(Activity activity, WebView web, String panelText, boolean panelAsk) {
        this.activity = activity;
        this.web = web;
        this.panelText = panelText == null ? "" : panelText;
        this.panelAsk = panelAsk;
    }

    @JavascriptInterface
    public String panelInit() {
        JSONObject out = new JSONObject();
        try {
            out.put("mode", panelAsk ? "ask" : "annotate");
            out.put("text", panelText);
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    @JavascriptInterface
    public String getSettings() {
        return Store.get(activity, "settings", "");
    }

    @JavascriptInterface
    public void saveSettings(String json) {
        Store.put(activity, "settings", json == null ? "" : json);
    }

    @JavascriptInterface
    public String getHistory() {
        return Store.array(activity, "history").toString();
    }

    @JavascriptInterface
    public void addHistory(String json) {
        Store.append(activity, "history", json, 500);
    }

    @JavascriptInterface
    public String getFavorites() {
        return Store.array(activity, "favorites").toString();
    }

    @JavascriptInterface
    public void addFavorite(String json) {
        Store.append(activity, "favorites", json, 200);
    }

    @JavascriptInterface
    public void removeFavorite(String id) {
        Store.removeById(activity, "favorites", id);
    }

    @JavascriptInterface
    public void updateFavorite(String json) {
        Store.updateFavorite(activity, json);
    }

    @JavascriptInterface
    public String getUsage() {
        return Store.array(activity, "usage").toString();
    }

    @JavascriptInterface
    public void addUsage(String json) {
        Store.append(activity, "usage", json, 1000);
    }

    @JavascriptInterface
    public void clearRecords() {
        Store.clearRecords(activity);
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
    public String getVersion() {
        return Updater.version(activity);
    }

    @JavascriptInterface
    public String isAccessibilityEnabled() {
        try {
            AccessibilityManager manager = (AccessibilityManager) activity
                    .getSystemService(Context.ACCESSIBILITY_SERVICE);
            if (manager != null) {
                List<AccessibilityServiceInfo> services = manager
                        .getEnabledAccessibilityServiceList(
                                AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
                for (AccessibilityServiceInfo info : services) {
                    ResolveInfo resolveInfo = info.getResolveInfo();
                    if (resolveInfo == null || resolveInfo.serviceInfo == null) {
                        continue;
                    }
                    String packageName = resolveInfo.serviceInfo.packageName;
                    String className = resolveInfo.serviceInfo.name;
                    if (activity.getPackageName().equals(packageName)
                            && className != null
                            && className.endsWith("SelectionService")) {
                        return "true";
                    }
                }
            }
        } catch (Exception ignored) {
        }
        try {
            String enabled = Settings.Secure.getString(
                    activity.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            String packageName = activity.getPackageName();
            String full = packageName + "/" + SelectionService.class.getName();
            String shortDot = packageName + "/." + SelectionService.class.getSimpleName();
            String shortPlain = packageName + "/" + SelectionService.class.getSimpleName();
            if (enabled != null
                    && (enabled.contains(full)
                    || enabled.contains(shortDot)
                    || enabled.contains(shortPlain))) {
                return "true";
            }
        } catch (Exception ignored) {
        }
        return "false";
    }

    @JavascriptInterface
    public String isAccessibilityConnected() {
        return SelectionService.isConnected() ? "true" : "false";
    }

    @JavascriptInterface
    public String isCaptureEnabled() {
        return (SelectionService.isConnected() && !SelectionService.isCaptureDisabled())
                ? "true" : "false";
    }

    @JavascriptInterface
    public void enableCapture() {
        if (!SelectionService.enableCaptureFromApp()) {
            openAccessibilitySettings();
        }
    }

    @JavascriptInterface
    public String isCaptureMaster() {
        return "0".equals(Store.get(activity, "captureEnabled", "1")) ? "false" : "true";
    }

    @JavascriptInterface
    public void setCaptureMaster(boolean enabled) {
        Store.put(activity, "captureEnabled", enabled ? "1" : "0");
        applyCaptureComponents(activity, enabled);
        SelectionService.applyCaptureMaster();
    }

    /** 关闭取词时同时禁用系统选中菜单里的「注解/提问」入口，开启时恢复。 */
    static void syncCaptureComponents(Context context) {
        applyCaptureComponents(context, !"0".equals(Store.get(context, "captureEnabled", "1")));
    }

    static void applyCaptureComponents(Context context, boolean on) {
        int state = on
                ? android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                : android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
        try {
            android.content.pm.PackageManager pm = context.getPackageManager();
            pm.setComponentEnabledSetting(
                    new android.content.ComponentName(context, AnnotateActivity.class),
                    state, android.content.pm.PackageManager.DONT_KILL_APP);
            pm.setComponentEnabledSetting(
                    new android.content.ComponentName(context, AskActivity.class),
                    state, android.content.pm.PackageManager.DONT_KILL_APP);
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void openAccessibilitySettings() {
        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public void openAppInfo() {
        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + activity.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public void checkUpdate(String manifestUrl, String callbackId) {
        Updater.check(activity, web, manifestUrl, callbackId);
    }

    @JavascriptInterface
    public void downloadUpdate(String url, String sha256, String versionCode,
                               String versionName, String callbackId) {
        int expectedCode = 0;
        try {
            expectedCode = Integer.parseInt(versionCode);
        } catch (Exception ignored) {
        }
        Updater.download(activity, web, url, sha256, expectedCode, versionName, callbackId);
    }

    @JavascriptInterface
    public void installUpdate(String uri, String callbackId) {
        Updater.install(activity, web, uri, callbackId);
    }

    @JavascriptInterface
    public void closePanel() {
        activity.runOnUiThread(activity::finish);
    }

    @JavascriptInterface
    public void copy(String text) {
        activity.runOnUiThread(() -> {
            ClipboardManager manager =
                    (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            manager.setPrimaryClip(ClipData.newPlainText("注解", text == null ? "" : text));
        });
    }

    @JavascriptInterface
    public void toast(String message) {
        activity.runOnUiThread(() ->
                Toast.makeText(activity, message == null ? "" : message, Toast.LENGTH_SHORT).show());
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
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(value)));
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public void openMain() {
        activity.runOnUiThread(() -> {
            Intent intent = new Intent(activity, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            intent.putExtra("openSettings", true);
            activity.startActivity(intent);
            activity.finish();
        });
    }

    @JavascriptInterface
    public void pickTextFile(String callbackId) {
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).pickTextFile(callbackId);
        }
    }
}
