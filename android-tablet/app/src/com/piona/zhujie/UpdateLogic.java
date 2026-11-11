package com.piona.zhujie;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 更新清单的纯函数逻辑（从 Updater 抽出，不依赖 org.json / Android，
 * 可在普通 JVM 上单测；Updater 里仍用 JSONObject 做最终解析，
 * 这里只负责“哪个更新、去哪下、清单全不全”这类可独立验证的判断）。
 *
 * 修复点（见 OPTIMIZATION_REPORT.md 更新器审计）：
 * 1. 旧逻辑只在主源版本 <= 当前版本时才拉备用源，主源一旦返回一个
 *    “比当前新、但比备用源旧”的过期清单，就永远拿不到最新版。
 *    现在：两个源都拉，取版本号较高的那个。
 * 2. 清单里的相对下载地址原来按 API 地址解析，会拼错；现在按 raw 官方源解析。
 * 3. 下载候选源原来只在“连不上”时兜底，校验失败/不完整直接报错；
 *    现在由 Updater 按候选逐个试（见 Updater.download 的重构）。
 */
public final class UpdateLogic {
    public static final String FALLBACK_MANIFEST_URL =
            "https://raw.githubusercontent.com/dolee676-sys/annotation-tool/main/"
                    + "android-release/latest.json";
    public static final String API_MANIFEST_URL =
            "https://api.github.com/repos/dolee676-sys/annotation-tool/"
                    + "contents/android-release/latest.json";
    private static final String RAW_PREFIX =
            "https://raw.githubusercontent.com/dolee676-sys/annotation-tool/main/";

    private UpdateLogic() {
    }

    /** 两个源都取到时，取版本号较高的；任一为空时取另一个。 */
    public static int pickNewestCode(int firstCode, int secondCode) {
        return Math.max(firstCode, secondCode);
    }

    /** 按“先官方直链，再 Release 资产，再 jsdelivr 镜像”排出下载候选。 */
    public static String[] downloadCandidates(String source, String versionName) {
        List<String> list = new ArrayList<>();
        if (source != null && !source.trim().isEmpty()) {
            list.add(source.trim());
        }
        String name = versionName == null ? "" : versionName.trim();
        if (!name.isEmpty()) {
            list.add("https://github.com/dolee676-sys/annotation-tool/releases/download/android-v"
                    + name + "/zhujie-tablet-" + name + ".apk");
        }
        if (source != null && source.startsWith(RAW_PREFIX)) {
            list.add("https://cdn.jsdelivr.net/gh/dolee676-sys/annotation-tool@main/"
                    + source.substring(RAW_PREFIX.length()));
        }
        return list.toArray(new String[0]);
    }

    /**
     * 最小清单解析：只取 versionCode / versionName / url / sha256 / size / notes。
     * 支持两种形态：① 直接就是清单 JSON；② GitHub Contents API 的 {content: base64} 包裹。
     * 返回 null 表示解析不出可用清单。Updater 仍会用 JSONObject 做严格校验，
     * 这里只做“能不能读”的快速判断与单测。
     */
    public static Manifest parseManifest(String body) {
        if (body == null) {
            return null;
        }
        String trimmed = body.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        Manifest direct = parseFields(trimmed);
        if (direct != null && direct.versionCode > 0) {
            return direct;
        }
        String encoded = stringField(trimmed, "content");
        if (encoded == null) {
            return null;
        }
        encoded = encoded.replace("\n", "").replace("\r", "").replace(" ", "");
        if (encoded.isEmpty()) {
            return null;
        }
        try {
            String decoded = new String(Base64.getDecoder().decode(encoded), "UTF-8");
            return parseFields(decoded);
        } catch (Exception ignored) {
            return null;
        }
    }

    public static Manifest parseFields(String json) {
        if (json == null) {
            return null;
        }
        Integer code = intField(json, "versionCode");
        String name = stringField(json, "versionName");
        String url = stringField(json, "url");
        String sha = stringField(json, "sha256");
        Long size = longField(json, "size");
        String notes = stringField(json, "notes");
        if (code == null && name == null && url == null && sha == null) {
            return null;
        }
        Manifest manifest = new Manifest();
        manifest.versionCode = code == null ? 0 : code;
        manifest.versionName = name == null ? "" : name;
        manifest.url = url == null ? "" : url;
        manifest.sha256 = sha == null ? "" : sha;
        manifest.size = size == null ? 0 : size;
        manifest.notes = notes == null ? "" : notes;
        return manifest;
    }

    /** 清单缺任何一项（版本号/版本名/地址/校验值）都算不完整，拒绝继续。 */
    public static boolean isComplete(Manifest manifest) {
        return manifest != null
                && manifest.versionCode > 0
                && !manifest.versionName.isEmpty()
                && !manifest.url.isEmpty()
                && !manifest.sha256.isEmpty();
    }

    /** 相对下载地址按 raw 官方源解析（旧代码按 API 地址解析会拼错）。 */
    public static String resolveDownloadUrl(String downloadUrl, String rawBase) {
        if (downloadUrl == null) {
            return "";
        }
        String value = downloadUrl.trim();
        if (value.startsWith("http://") || value.startsWith("https://")) {
            return value;
        }
        String base = rawBase == null || rawBase.isEmpty() ? FALLBACK_MANIFEST_URL : rawBase;
        int slash = base.lastIndexOf('/');
        String dir = slash >= 0 ? base.substring(0, slash + 1) : base + "/";
        return dir + value;
    }

    private static Integer intField(String json, String key) {
        Long value = longField(json, key);
        return value == null ? null : value.intValue();
    }

    private static Long longField(String json, String key) {
        Matcher matcher = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*(-?\\d+)")
                .matcher(json);
        if (!matcher.find()) {
            return null;
        }
        try {
            return Long.parseLong(matcher.group(1));
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String stringField(String json, String key) {
        Matcher matcher = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"")
                .matcher(json);
        if (!matcher.find()) {
            return null;
        }
        return matcher.group(1)
                .replace("\\\"", "\"")
                .replace("\\\\", "\\")
                .replace("\\n", "\n");
    }

    /** 最小清单数据（只含更新需要的字段）。 */
    public static final class Manifest {
        public int versionCode;
        public String versionName = "";
        public String url = "";
        public String sha256 = "";
        public long size;
        public String notes = "";
    }
}
