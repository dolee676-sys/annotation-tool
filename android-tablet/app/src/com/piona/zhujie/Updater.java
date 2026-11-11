package com.piona.zhujie;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

public final class Updater {
    private static final String LEGACY_NAME = "zhujie-update.apk";
    private static final String FALLBACK_MANIFEST_URL =
            "https://raw.githubusercontent.com/dolee676-sys/annotation-tool/main/"
                    + "android-release/latest.json";

    private static String cacheName(int code) {
        return "zhujie-update-" + code + ".apk";
    }

    private static String[] downloadCandidates(String source, String versionName) {
        java.util.List<String> list = new java.util.ArrayList<>();
        list.add(source);
        String name = versionName == null ? "" : versionName.trim();
        if (!name.isEmpty()) {
            list.add("https://github.com/dolee676-sys/annotation-tool/releases/download/android-v"
                    + name + "/zhujie-tablet-" + name + ".apk");
        }
        String prefix = "https://raw.githubusercontent.com/dolee676-sys/annotation-tool/main/";
        if (source.startsWith(prefix)) {
            list.add("https://cdn.jsdelivr.net/gh/dolee676-sys/annotation-tool@main/"
                    + source.substring(prefix.length()));
        }
        return list.toArray(new String[0]);
    }

    private Updater() {
    }

    public static String version(Activity activity) {
        try {
            PackageInfo info = activity.getPackageManager()
                    .getPackageInfo(activity.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode()
                    : info.versionCode;
            return info.versionName + " (" + code + ")";
        } catch (Exception exception) {
            return "0.1.2 (3)";
        }
    }

    public static void check(Activity activity, WebView web, String manifestUrl, String callbackId) {
        new Thread(() -> {
            try {
                String url = manifestUrl == null ? "" : manifestUrl.trim();
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    url = "https://api.github.com/repos/dolee676-sys/annotation-tool/"
                            + "contents/android-release/latest.json";
                }
                PackageInfo info = activity.getPackageManager()
                        .getPackageInfo(activity.getPackageName(), 0);
                long currentCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                        ? info.getLongVersionCode()
                        : info.versionCode;

                JSONObject primary = fetchManifest(url);
                int primaryCode = primary == null
                        ? 0 : primary.optInt("versionCode", 0);
                JSONObject fallback = null;
                if (primaryCode <= currentCode) {
                    fallback = fetchManifest(FALLBACK_MANIFEST_URL);
                }
                JSONObject manifest = pickNewest(primary, fallback);
                if (manifest == null) {
                    emitError(web, callbackId,
                            "更新清单读取失败：两个官方更新源都连不上，请检查平板网络。");
                    return;
                }
                int remoteCode = manifest.optInt("versionCode", 0);
                String remoteName = manifest.optString("versionName", "");
                String downloadUrl = manifest.optString("url", "");
                String sha256 = manifest.optString("sha256", "");
                if (remoteCode <= 0 || remoteName.isEmpty()
                        || downloadUrl.isEmpty() || sha256.isEmpty()) {
                    emitError(web, callbackId, "更新清单内容不完整，已停止检查。");
                    return;
                }
                if (!downloadUrl.startsWith("http")) {
                    downloadUrl = new URL(new URL(url), downloadUrl).toString();
                }
                JSONObject result = new JSONObject();
                result.put("available", remoteCode > currentCode);
                result.put("currentVersion", info.versionName + " (" + currentCode + ")");
                result.put("latestVersion", remoteName);
                result.put("versionCode", remoteCode);
                result.put("notes", manifest.optString("notes", ""));
                result.put("url", downloadUrl);
                result.put("sha256", sha256);
                result.put("size", manifest.optLong("size", 0));
                emit(web, "window.__updateResult(" + JSONObject.quote(callbackId)
                        + "," + result + ");");
            } catch (Exception exception) {
                emitError(web, callbackId, friendly(exception.getMessage()));
            }
        }, "zhujie-update-check").start();
    }

    private static JSONObject fetchManifest(String rawUrl) {
        HttpURLConnection connection = null;
        try {
            String url = rawUrl == null ? "" : rawUrl.trim();
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                return null;
            }
            boolean api = url.contains("api.github.com") && url.contains("/contents/");
            String requestUrl = url + (url.contains("?") ? "&" : "?")
                    + (api ? "ref=main&" : "") + "t=" + System.nanoTime();
            connection = (HttpURLConnection) new URL(requestUrl).openConnection();
            connection.setUseCaches(false);
            connection.setConnectTimeout(12_000);
            connection.setReadTimeout(12_000);
            connection.setRequestProperty("Accept",
                    api ? "application/vnd.github.raw+json" : "application/json");
            connection.setRequestProperty("Cache-Control", "no-cache, no-store");
            connection.setRequestProperty("Pragma", "no-cache");
            connection.setRequestProperty("User-Agent", "zhujie-android");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                return null;
            }
            return parseManifest(readAll(connection.getInputStream()));
        } catch (Exception exception) {
            return null;
        } finally {
            if (connection != null) {
                try {
                    connection.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private static JSONObject parseManifest(String body) throws Exception {
        String trimmed = body == null ? "" : body.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        JSONObject object = new JSONObject(trimmed);
        if (object.has("versionCode")) {
            return object;
        }
        String encoded = object.optString("content", "")
                .replace("\n", "")
                .replace("\r", "");
        if (encoded.isEmpty()) {
            return null;
        }
        byte[] decoded = Base64.decode(encoded, Base64.DEFAULT);
        return new JSONObject(new String(decoded, StandardCharsets.UTF_8));
    }

    private static JSONObject pickNewest(JSONObject first, JSONObject second) {
        if (first == null) {
            return second;
        }
        if (second == null) {
            return first;
        }
        return second.optInt("versionCode", 0) > first.optInt("versionCode", 0)
                ? second : first;
    }

    public static void download(Activity activity, WebView web, String url, String sha,
                                int expectedCode, String versionName, String callbackId) {
        String source = url == null ? "" : url.trim();
        String expected = sha == null ? "" : sha.trim().toLowerCase(Locale.ROOT);
        if (!source.startsWith("http://") && !source.startsWith("https://")) {
            emitError(web, callbackId, "更新下载地址不正确。");
            return;
        }
        if (expected.isEmpty()) {
            emitError(web, callbackId, "更新清单缺少校验值，已停止下载。");
            return;
        }
        new Thread(() -> {
            HttpURLConnection connection = null;
            File target = new File(activity.getCacheDir(), cacheName(expectedCode));
            try {
                File[] cached = activity.getCacheDir().listFiles();
                if (cached != null) {
                    for (File old : cached) {
                        String n = old.getName();
                        if (!old.equals(target)
                                && (n.equals(LEGACY_NAME)
                                || (n.startsWith("zhujie-update-") && n.endsWith(".apk")))) {
                            old.delete();
                        }
                    }
                }
                if (target.exists()) {
                    target.delete();
                }
                InputStream downloadStream = null;
                long total = 0;
                for (String candidate : downloadCandidates(source, versionName)) {
                    HttpURLConnection probe = null;
                    try {
                        probe = (HttpURLConnection) new URL(
                                candidate + (candidate.contains("?") ? "&" : "?") + "t="
                                        + System.currentTimeMillis()).openConnection();
                        probe.setUseCaches(false);
                        probe.setConnectTimeout(15_000);
                        probe.setReadTimeout(30_000);
                        probe.setRequestProperty("Accept", "application/vnd.android.package-archive");
                        probe.setRequestProperty("Cache-Control", "no-cache");
                        int status = probe.getResponseCode();
                        if (status >= 200 && status < 300) {
                            connection = probe;
                            downloadStream = probe.getInputStream();
                            total = probe.getContentLengthLong();
                            break;
                        }
                        probe.disconnect();
                    } catch (Exception exception) {
                        if (probe != null) {
                            probe.disconnect();
                        }
                    }
                }
                if (downloadStream == null) {
                    emitError(web, callbackId,
                            "下载失败：更新源都连不上。可用浏览器到 GitHub Releases 下载该版本后手动安装。");
                    return;
                }
                long done = 0;
                int lastPercent = -1;
                try (InputStream input = downloadStream;
                     FileOutputStream output = new FileOutputStream(target)) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) > 0) {
                        if (activity.isFinishing()) {
                            target.delete();
                            return;
                        }
                        output.write(buffer, 0, read);
                        done += read;
                        int percent = total > 0
                                ? (int) Math.min(100, done * 100 / total)
                                : 0;
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            emit(web, "window.__updateProgress("
                                    + JSONObject.quote(callbackId) + "," + percent
                                    + "," + done + "," + total + ");");
                        }
                    }
                }
                if (total > 0 && target.length() != total) {
                    target.delete();
                    emitError(web, callbackId, "下载不完整，请重试。");
                    return;
                }
                String actual = sha256(target);
                if (!actual.equals(expected)) {
                    target.delete();
                    emitError(web, callbackId, "安装包校验失败，已删除，请重试。");
                    return;
                }
                PackageInfo archive = activity.getPackageManager()
                        .getPackageArchiveInfo(target.getAbsolutePath(), 0);
                long apkCode = archive == null
                        ? -1
                        : (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                        ? archive.getLongVersionCode()
                        : archive.versionCode);
                String apkName = archive == null ? "未知" : archive.versionName;
                PackageInfo current = activity.getPackageManager()
                        .getPackageInfo(activity.getPackageName(), 0);
                long currentCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                        ? current.getLongVersionCode()
                        : current.versionCode;
                if (apkCode <= 0) {
                    target.delete();
                    emitError(web, callbackId, "无法读取更新包版本，已取消安装。");
                    return;
                }
                if (expectedCode > 0 && apkCode != expectedCode) {
                    target.delete();
                    emitError(web, callbackId, "更新包版本与清单不一致（清单 "
                            + expectedCode + "，安装包 " + apkCode + "），已删除。");
                    return;
                }
                if (apkCode <= currentCode) {
                    target.delete();
                    emitError(web, callbackId, "下载到的版本 " + apkName + " (" + apkCode
                            + ") 不高于当前版本 (" + currentCode + ")，已取消安装。");
                    return;
                }
                String trust = trustError(activity, target);
                if (trust != null) {
                    target.delete();
                    emitError(web, callbackId, trust);
                    return;
                }
                emit(web, "window.__updateDownloaded(" + JSONObject.quote(callbackId)
                        + "," + JSONObject.quote(UpdateFileProvider.uriFor(target.getName()).toString())
                        + "," + JSONObject.quote(apkName == null ? "" : apkName)
                        + "," + apkCode + ");");
            } catch (Exception exception) {
                if (target.exists()) {
                    target.delete();
                }
                emitError(web, callbackId, friendly(exception.getMessage()));
            } finally {
                if (connection != null) {
                    try {
                        connection.disconnect();
                    } catch (Exception ignored) {
                    }
                }
            }
        }, "zhujie-update-download").start();
    }

    public static void install(Activity activity, WebView web, String uriString,
                               String callbackId) {
        if (uriString == null || uriString.isEmpty()) {
            emitError(web, callbackId, "没有可安装的更新包。");
            return;
        }
        final String[] detail = new String[1];
        try {
            File target = new File(activity.getCacheDir(), UpdateFileProvider.safeName(Uri.parse(uriString)));
            if (!target.exists()) {
                emitError(web, callbackId, "没有可安装的更新包，请重新检查更新。");
                return;
            }
            PackageInfo archive = activity.getPackageManager()
                    .getPackageArchiveInfo(target.getAbsolutePath(), 0);
            long apkCode = archive == null
                    ? -1
                    : (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? archive.getLongVersionCode()
                    : archive.versionCode);
            PackageInfo current = activity.getPackageManager()
                    .getPackageInfo(activity.getPackageName(), 0);
            long currentCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? current.getLongVersionCode()
                    : current.versionCode;
            if (apkCode <= 0) {
                target.delete();
                emitError(web, callbackId, "安装包无效，已删除，请重新检查更新。");
                return;
            }
            if (apkCode <= currentCode) {
                target.delete();
                emitError(web, callbackId,
                        "缓存里的安装包版本不高于当前版本，已删除，请重新检查更新。");
                return;
            }
            detail[0] = "当前 " + currentCode + " → 包内 " + apkCode;
            String trust = trustError(activity, target);
            if (trust != null) {
                target.delete();
                emitError(web, callbackId, trust);
                return;
            }
        } catch (Exception exception) {
            emitError(web, callbackId, "检查安装包失败，请重新下载。");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !activity.getPackageManager().canRequestPackageInstalls()) {
            emit(web, "window.__updateNeedPermission(" + JSONObject.quote(callbackId) + ");");
            activity.runOnUiThread(() -> {
                Toast.makeText(activity, "请允许「注解」安装未知应用，然后回来再点安装。",
                        Toast.LENGTH_LONG).show();
                try {
                    Intent settings = new Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + activity.getPackageName()));
                    settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(settings);
                } catch (Exception ignored) {
                }
            });
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(Uri.parse(uriString),
                        "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_ACTIVITY_NEW_TASK);
                emit(web, "window.__updateInstalling(" + JSONObject.quote(callbackId)
                        + "," + JSONObject.quote(detail[0] == null ? "" : detail[0]) + ");");
                activity.startActivity(intent);
            } catch (Exception exception) {
                emitError(web, callbackId, "无法打开安装界面：" + friendly(exception.getMessage()));
            }
        });
    }

    private static int signingFlags() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
    }

    private static java.util.List<String> signerIds(PackageInfo info) {
        java.util.List<String> ids = new java.util.ArrayList<>();
        if (info == null) {
            return ids;
        }
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            signatures = info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        if (signatures != null) {
            for (Signature signature : signatures) {
                ids.add(signature.toCharsString());
            }
        }
        return ids;
    }

    /** S-03：只允许与本应用同包名、同签名证书的 APK 安装。 */
    private static String trustError(Activity activity, File target) {
        try {
            PackageManager pm = activity.getPackageManager();
            PackageInfo archive = pm.getPackageArchiveInfo(
                    target.getAbsolutePath(), signingFlags());
            if (archive == null || !activity.getPackageName().equals(archive.packageName)) {
                return "更新包包名不符，已拒绝安装。";
            }
            PackageInfo current = pm.getPackageInfo(
                    activity.getPackageName(), signingFlags());
            java.util.List<String> archiveSigners = signerIds(archive);
            java.util.List<String> currentSigners = signerIds(current);
            if (archiveSigners.isEmpty()
                    || archiveSigners.size() != currentSigners.size()
                    || !currentSigners.containsAll(archiveSigners)) {
                return "更新包签名与当前应用不一致，已拒绝安装。";
            }
            return null;
        } catch (Exception exception) {
            return "无法校验更新包签名，已拒绝安装。";
        }
    }

    private static String readAll(InputStream input) throws Exception {
        try (InputStream stream = input;
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            int total = 0;
            while ((read = stream.read(buffer)) > 0 && total < 128_000) {
                output.write(buffer, 0, read);
                total += read;
            }
            return output.toString("UTF-8");
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) > 0) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder builder = new StringBuilder();
        for (byte value : digest.digest()) {
            builder.append(String.format(Locale.ROOT, "%02x", value));
        }
        return builder.toString();
    }

    private static String friendly(String message) {
        String value = message == null ? "" : message.trim();
        if (value.isEmpty()) {
            return "网络请求失败。";
        }
        String lower = value.toLowerCase(Locale.ROOT);
        if (lower.contains("unable to resolve host") || lower.contains("unknownhost")) {
            return "连不上更新服务器，请确认地址和网络。";
        }
        if (lower.contains("failed to connect")
                || lower.contains("connection refused")
                || lower.contains("econnrefused")) {
            return "连不上更新服务器：请确认电脑上的更新服务开着、平板和电脑在同一 Wi-Fi；或把更新地址改成公网地址。";
        }
        if (lower.contains("timeout") || lower.contains("timed out")) {
            return "更新服务器响应超时。";
        }
        return value;
    }

    private static void emitError(WebView web, String id, String message) {
        emit(web, "window.__updateError(" + JSONObject.quote(id) + ","
                + JSONObject.quote(message == null ? "更新失败" : message) + ");");
    }

    private static void emit(WebView web, String script) {
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
}
