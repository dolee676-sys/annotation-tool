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

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 应用内更新：检查清单 → 下载 → 校验 → 交系统安装。
 *
 * 安全红线（不动）：只接受同包名、同签名证书、versionCode 更高的包；
 * SHA-256 校验不过直接删包；拒绝降级。见 trustError()。
 *
 * 本次修复（逐项见 OPTIMIZATION_REPORT.md「更新器审计」）：
 * U1 检查双源：旧逻辑只在主源版本 <= 当前版本时才拉备用源，主源一旦返回
 *    一个“比当前新、但比备用源旧”的过期清单，就永远拿不到最新版。
 *    现在两个源都拉，取版本号较高的那个。
 * U2 下载看门狗误杀：旧逻辑只在百分比变化时才上报进度；Content-Length
 *    缺失时百分比永远是 0，前端 30 秒看门狗会把“正在下”误判成“卡死”，
 *    而 Java 线程还在后台继续下，之后还会突然弹出安装。现在进度按
 *    “百分比变化 或 距上次上报 >= 1 秒 或 已下 >= 64KB”三条件上报，
 *    且看门狗可真正取消下载（cancelDownload），不再出现幽灵安装。
 * U3 静默取消：下载中页面关闭时旧逻辑直接 return，前端永远停在“下载中”。
 *    现在发一条明确的错误回调。
 * U4 候选源只兜底“连不上”：旧逻辑第一个候选一旦返回 200 就死守到底，
 *    校验失败/下载不完整直接报错。现在每个候选独立下载到临时文件并完整
 *    校验（长度 + SHA-256 + 版本 + 签名），失败就删临时文件换下一个源，
 *    全部失败才报错，并告诉用户手动下载地址。
 * U5 检查死锁：旧逻辑检查回调一旦丢失（WebView 销毁等），前端 checking
 *    永远 true，再点“检查更新”直接 return，只能重启应用。现在前端加了
 *    20 秒检查看门狗（见 app.js），Java 侧 12 秒超时不变。
 * U6 相对下载地址：旧逻辑按 API 地址解析相对地址会拼错；现在按 raw 官方源解析。
 * U7 缓存复用：已下载且校验通过的同版本包不再重复下载（此前每次重下）。
 */
public final class Updater {
    private static final String LEGACY_NAME = "zhujie-update.apk";
    private static final long DOWNLOAD_DEADLINE_MS = 120_000;
    private static final long PROGRESS_MIN_INTERVAL_MS = 1000;
    private static final long PROGRESS_MIN_BYTES = 64 * 1024;

    /** 前端看门狗超时后调用，正在下载的线程会在下一个数据块处停下。 */
    private static final Set<String> CANCELLED_DOWNLOADS =
            Collections.newSetFromMap(new ConcurrentHashMap<String, Boolean>());

    private static String cacheName(int code) {
        return "zhujie-update-" + code + ".apk";
    }

    private static String tempName(int code) {
        return "zhujie-update-" + code + ".apk.tmp";
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

    public static void cancelDownload(String callbackId) {
        if (callbackId != null) {
            CANCELLED_DOWNLOADS.add(callbackId);
        }
    }

    public static void check(Activity activity, WebView web, String manifestUrl, String callbackId) {
        new Thread(() -> {
            try {
                String url = manifestUrl == null ? "" : manifestUrl.trim();
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    url = UpdateLogic.API_MANIFEST_URL;
                }
                PackageInfo info = activity.getPackageManager()
                        .getPackageInfo(activity.getPackageName(), 0);
                long currentCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                        ? info.getLongVersionCode()
                        : info.versionCode;

                // U1：两个源都拉，取版本号较高的那个，不再只在主源过旧时才看备用源。
                JSONObject primary = fetchManifest(url);
                JSONObject fallback = fetchManifest(UpdateLogic.FALLBACK_MANIFEST_URL);
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
                // U6：相对地址按 raw 官方源解析。
                if (!downloadUrl.startsWith("http")) {
                    downloadUrl = UpdateLogic.resolveDownloadUrl(
                            downloadUrl, UpdateLogic.FALLBACK_MANIFEST_URL);
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
            return parseManifest(HttpSupport.readAll(connection.getInputStream(), 128_000));
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
        download(activity, web, url, sha, expectedCode, versionName, callbackId, 0);
    }

    /** size 为清单里的期望字节数（0 表示清单没给，不做长度校验）。 */
    public static void download(Activity activity, WebView web, String url, String sha,
                                int expectedCode, String versionName, String callbackId,
                                long expectedSize) {
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
            File target = new File(activity.getCacheDir(), cacheName(expectedCode));
            try {
                // U7：已下载且校验通过的同版本包直接复用，不再重复下载。
                if (expectedCode > 0 && target.exists()
                        && expected.equals(HttpSupport.sha256(target))
                        && archiveCode(activity, target) == expectedCode
                        && trustError(activity, target) == null) {
                    PackageInfo archive = activity.getPackageManager()
                            .getPackageArchiveInfo(target.getAbsolutePath(), 0);
                    emit(web, "window.__updateDownloaded(" + JSONObject.quote(callbackId)
                            + "," + JSONObject.quote(UpdateFileProvider.uriFor(target.getName()).toString())
                            + "," + JSONObject.quote(archive == null ? "" : String.valueOf(archive.versionName))
                            + "," + expectedCode + ");");
                    return;
                }
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
                String lastError = null;
                long startedAt = System.currentTimeMillis();
                // U4：每个候选源独立下载到临时文件并完整校验，失败换下一个源。
                for (String candidate : UpdateLogic.downloadCandidates(source, versionName)) {
                    if (CANCELLED_DOWNLOADS.contains(callbackId)) {
                        emitError(web, callbackId, "下载已取消。");
                        return;
                    }
                    if (System.currentTimeMillis() - startedAt > DOWNLOAD_DEADLINE_MS) {
                        lastError = "下载超时（超过 120 秒），网络太慢或更新源无响应。";
                        break;
                    }
                    File temp = new File(activity.getCacheDir(), tempName(expectedCode));
                    if (temp.exists()) {
                        temp.delete();
                    }
                    DownloadResult outcome = downloadOne(activity, web, candidate,
                            temp, callbackId, startedAt);
                    if (outcome.cancelled) {
                        emitError(web, callbackId, "下载已取消。");
                        return;
                    }
                    if (outcome.finished) {
                        if (activity.isFinishing()) {
                            temp.delete();
                            // U3：页面关闭也不静默，前端收到这条后会恢复按钮。
                            emitError(web, callbackId, "页面已关闭，下载已取消。");
                            return;
                        }
                        if (expectedSize > 0 && temp.length() != expectedSize) {
                            temp.delete();
                            lastError = "下载不完整（大小与清单不一致），已换源重试。";
                            continue;
                        }
                        String actual = HttpSupport.sha256(temp);
                        if (!actual.equals(expected)) {
                            temp.delete();
                            lastError = "安装包校验失败，已换源重试。";
                            continue;
                        }
                        long apkCode = archiveCode(activity, temp);
                        if (apkCode <= 0) {
                            temp.delete();
                            lastError = "无法读取更新包版本，已换源重试。";
                            continue;
                        }
                        if (expectedCode > 0 && apkCode != expectedCode) {
                            temp.delete();
                            lastError = "更新包版本与清单不一致（清单 "
                                    + expectedCode + "，安装包 " + apkCode + "），已换源重试。";
                            continue;
                        }
                        PackageInfo current = activity.getPackageManager()
                                .getPackageInfo(activity.getPackageName(), 0);
                        long currentCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                                ? current.getLongVersionCode()
                                : current.versionCode;
                        if (apkCode <= currentCode) {
                            temp.delete();
                            lastError = "下载到的版本不高于当前版本，已取消安装。";
                            continue;
                        }
                        String trust = trustError(activity, temp);
                        if (trust != null) {
                            temp.delete();
                            // 签名/包名问题换源也救不了，直接报错，不再浪费时间试别的源。
                            emitError(web, callbackId, trust);
                            return;
                        }
                        if (!temp.renameTo(target)) {
                            temp.delete();
                            lastError = "保存安装包失败，请重试。";
                            continue;
                        }
                        PackageInfo archive = activity.getPackageManager()
                                .getPackageArchiveInfo(target.getAbsolutePath(), 0);
                        String apkName = archive == null ? "" : archive.versionName;
                        emit(web, "window.__updateDownloaded(" + JSONObject.quote(callbackId)
                                + "," + JSONObject.quote(UpdateFileProvider.uriFor(target.getName()).toString())
                                + "," + JSONObject.quote(apkName == null ? "" : apkName)
                                + "," + apkCode + ");");
                        return;
                    }
                    // 失败：记下原因，换下一个候选源。
                    lastError = outcome.message;
                }
                if (target.exists()) {
                    target.delete();
                }
                emitError(web, callbackId,
                        "下载失败：更新源都试过了（"
                                + (lastError == null ? "连不上" : lastError)
                                + "）。可用浏览器到 GitHub Releases 下载该版本后手动安装。");
            } catch (Exception exception) {
                if (target.exists()) {
                    target.delete();
                }
                emitError(web, callbackId, friendly(exception.getMessage()));
            } finally {
                CANCELLED_DOWNLOADS.remove(callbackId);
            }
        }, "zhujie-update-download").start();
    }

    /** 单次候选源下载的结果（不用共享可变枚举，避免并发下载互相改写原因）。 */
    private static final class DownloadResult {
        final boolean finished;
        final boolean cancelled;
        final String message;

        DownloadResult(boolean finished, boolean cancelled, String message) {
            this.finished = finished;
            this.cancelled = cancelled;
            this.message = message;
        }

        static DownloadResult finished() {
            return new DownloadResult(true, false, null);
        }

        static DownloadResult cancelled() {
            return new DownloadResult(false, true, "下载已取消。");
        }

        static DownloadResult failed(String message) {
            return new DownloadResult(false, false, message);
        }
    }

    private static DownloadResult downloadOne(Activity activity, WebView web, String candidate,
                                              File temp, String callbackId, long startedAt) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(
                    candidate + (candidate.contains("?") ? "&" : "?") + "t="
                            + System.currentTimeMillis()).openConnection();
            connection.setUseCaches(false);
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
            connection.setRequestProperty("Cache-Control", "no-cache");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                return DownloadResult.failed("更新源返回 HTTP " + status + "。");
            }
            long total = connection.getContentLengthLong();
            long done = 0;
            int lastPercent = -1;
            long lastEmitAt = System.currentTimeMillis();
            long lastEmitBytes = 0;
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(temp)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) > 0) {
                    if (CANCELLED_DOWNLOADS.contains(callbackId)) {
                        return DownloadResult.cancelled();
                    }
                    if (activity.isFinishing()) {
                        temp.delete();
                        return DownloadResult.cancelled();
                    }
                    if (System.currentTimeMillis() - startedAt > DOWNLOAD_DEADLINE_MS) {
                        return DownloadResult.failed("下载超时（超过 120 秒）。");
                    }
                    output.write(buffer, 0, read);
                    done += read;
                    int percent = total > 0
                            ? (int) Math.min(100, done * 100 / total)
                            : 0;
                    long now = System.currentTimeMillis();
                    // U2：Content-Length 缺失时百分比恒为 0，旧逻辑再也不上报，
                    // 前端看门狗会误判卡死。现在按时间/字节量也上报。
                    if (percent != lastPercent
                            || now - lastEmitAt >= PROGRESS_MIN_INTERVAL_MS
                            || done - lastEmitBytes >= PROGRESS_MIN_BYTES) {
                        lastPercent = percent;
                        lastEmitAt = now;
                        lastEmitBytes = done;
                        emit(web, "window.__updateProgress("
                                + JSONObject.quote(callbackId) + "," + percent
                                + "," + done + "," + total + ");");
                    }
                }
            }
            if (total > 0 && temp.length() != total) {
                return DownloadResult.failed("下载不完整，请重试。");
            }
            return DownloadResult.finished();
        } catch (Exception exception) {
            if (CANCELLED_DOWNLOADS.contains(callbackId)) {
                return DownloadResult.cancelled();
            }
            return DownloadResult.failed(friendly(exception.getMessage()));
        } finally {
            if (connection != null) {
                try {
                    connection.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private static long archiveCode(Activity activity, File file) {
        try {
            PackageInfo archive = activity.getPackageManager()
                    .getPackageArchiveInfo(file.getAbsolutePath(), 0);
            if (archive == null) {
                return -1;
            }
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? archive.getLongVersionCode()
                    : archive.versionCode;
        } catch (Exception ignored) {
            return -1;
        }
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

    private static String friendly(String message) {
        String value = message == null ? "" : message.trim();
        if (value.isEmpty()) {
            return "网络请求失败。";
        }
        String hint = HttpSupport.networkHint(value);
        if ("HOST".equals(hint)) {
            return "连不上更新服务器，请确认地址和网络。";
        }
        if ("CONNECT".equals(hint)) {
            return "连不上更新服务器：请确认电脑上的更新服务开着、平板和电脑在同一 Wi-Fi；或把更新地址改成公网地址。";
        }
        if ("TIMEOUT".equals(hint)) {
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
