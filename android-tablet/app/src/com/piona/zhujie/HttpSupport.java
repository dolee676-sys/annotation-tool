package com.piona.zhujie;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * AiClient / Updater / ScreenOcr 原来各写一份的 HTTP 读流、SHA-256 与网络错误文案，
 * 收敛到这里。三处行为保持不变，只是去掉重复。
 *
 * 注意：这里刻意不依赖 org.json 与任何 Android 类（除纯 Java API 外），
 * 以便纯函数测试可以在普通 JVM 上跑。
 */
public final class HttpSupport {
    private HttpSupport() {
    }

    /** 带上限地读完一个流；超限部分丢弃，避免超大错误体把内存撑爆。 */
    public static String readAll(InputStream input, int maxBytes) {
        if (input == null) {
            return "";
        }
        try (InputStream stream = input;
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            int total = 0;
            while ((read = stream.read(buffer)) > 0 && total < maxBytes) {
                output.write(buffer, 0, read);
                total += read;
            }
            return output.toString("UTF-8");
        } catch (Exception ignored) {
            return "";
        }
    }

    public static String readAll(InputStream input) {
        return readAll(input, 64_000);
    }

    public static String sha256(File file) throws Exception {
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

    /** 三处原来各自写的“连不上 / 超时”判断，统一成一份；返回 null 表示无法归类。 */
    public static String networkHint(String message) {
        String value = message == null ? "" : message.trim();
        if (value.isEmpty()) {
            return null;
        }
        String lower = value.toLowerCase(Locale.ROOT);
        if (lower.contains("unable to resolve host") || lower.contains("unknownhost")) {
            return "HOST";
        }
        if (lower.contains("failed to connect") || lower.contains("connection refused")
                || lower.contains("econnrefused")) {
            return "CONNECT";
        }
        if (lower.contains("timeout") || lower.contains("timed out")) {
            return "TIMEOUT";
        }
        return null;
    }
}
