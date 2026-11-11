package com.piona.zhujie;

import java.util.Locale;

/**
 * 从 AiClient 抽出的公网地址安全检查（S-02），行为与原来完全一致。
 * 公网必须 HTTPS；HTTP 仅允许本机/私有网段，避免 Key 与截图明文外传。
 * 返回 null 表示安全，否则返回提示文案。纯函数，可在普通 JVM 上测试。
 */
public final class UrlSafety {
    private UrlSafety() {
    }

    public static String baseUrlError(String base) {
        if (base == null) {
            return "接口地址为空。";
        }
        String b = base.trim().toLowerCase(Locale.ROOT);
        if (b.startsWith("https://")) {
            return null;
        }
        if (!b.startsWith("http://")) {
            return "接口地址必须以 http:// 或 https:// 开头。";
        }
        String host = b.substring(7);
        int slash = host.indexOf('/');
        if (slash >= 0) host = host.substring(0, slash);
        int colon = host.indexOf(':');
        if (colon >= 0) host = host.substring(0, colon);
        if (host.equals("localhost") || host.equals("127.0.0.1")
                || host.equals("::1") || host.equals("[::1]")) {
            return null;
        }
        if (host.startsWith("10.") || host.startsWith("192.168.")) {
            return null;
        }
        if (host.startsWith("172.")) {
            String[] parts = host.split("\\.");
            if (parts.length == 4) {
                try {
                    int second = Integer.parseInt(parts[1]);
                    if (second >= 16 && second <= 31) return null;
                } catch (Exception ignored) {
                }
            }
        }
        return "自定义接口是 HTTP 明文，仅允许本机/局域网地址；公网请改用 HTTPS，否则 Key 与内容会明文传输。";
    }
}
