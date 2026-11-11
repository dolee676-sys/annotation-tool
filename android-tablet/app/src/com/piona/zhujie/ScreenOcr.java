package com.piona.zhujie;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public final class ScreenOcr {
    public interface Callback {
        void onResult(String text, String error);
    }

    private static final String[] MODELS = {
            "qwen3-vl-plus", "qwen-vl-max", "qwen-vl-plus"
    };

    private ScreenOcr() {
    }

    public static void recognize(String baseUrl, String apiKey, String imageBase64,
                                 Callback callback) {
        new Thread(() -> {
            String urlError = AiClient.baseUrlError(baseUrl);
            if (urlError != null) {
                callback.onResult(null, urlError);
                return;
            }
            String lastError = null;
            for (String model : MODELS) {
                try {
                    String text = request(baseUrl, apiKey, model, imageBase64);
                    if (text != null && !text.trim().isEmpty()) {
                        callback.onResult(text.trim(), null);
                        return;
                    }
                    lastError = "识图模型没有返回文字。";
                } catch (Exception exception) {
                    String message = exception.getMessage() == null
                            ? "识图失败" : exception.getMessage();
                    lastError = friendly(message);
                    String lower = message.toLowerCase(Locale.ROOT);
                    if (lower.contains("model")
                            && (lower.contains("not found")
                            || lower.contains("not exist")
                            || lower.contains("invalid"))) {
                        continue;
                    }
                    break;
                }
            }
            callback.onResult(null, lastError == null ? "识图失败" : lastError);
        }, "zhujie-screen-ocr").start();
    }

    private static String request(String baseUrl, String apiKey, String model,
                                  String imageBase64) throws Exception {
        String base = baseUrl == null ? "" : baseUrl.trim();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        JSONObject body = new JSONObject();
        body.put("model", model);
        body.put("stream", false);
        body.put("temperature", 0);
        body.put("max_tokens", 4000);

        JSONArray messages = new JSONArray();
        messages.put(new JSONObject()
                .put("role", "system")
                .put("content", "你是一个 OCR 引擎。只提取图片中的正文文字，按阅读顺序、"
                        + "保留段落换行；不要解释、总结、翻译，不要输出状态栏、按钮或菜单文字。"));
        JSONArray content = new JSONArray();
        content.put(new JSONObject()
                .put("type", "text")
                .put("text", "提取这张截图里的正文文字，只输出文字。"));
        content.put(new JSONObject()
                .put("type", "image_url")
                .put("image_url", new JSONObject()
                        .put("url", "data:image/jpeg;base64," + imageBase64)));
        messages.put(new JSONObject()
                .put("role", "user")
                .put("content", content));
        body.put("messages", messages);

        HttpURLConnection connection = (HttpURLConnection) new URL(
                base + "/chat/completions").openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(120_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Authorization", "Bearer " + apiKey);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream() : connection.getErrorStream();
            String raw = readAll(stream);
            if (status < 200 || status >= 300) {
                throw new Exception(raw.isEmpty() ? "HTTP " + status : raw);
            }
            JSONObject response = new JSONObject(raw);
            JSONArray choices = response.optJSONArray("choices");
            if (choices == null || choices.length() == 0) {
                throw new Exception("识图模型没有返回内容。");
            }
            JSONObject message = choices.getJSONObject(0).optJSONObject("message");
            if (message == null) {
                return "";
            }
            String value = message.optString("content", "");
            if (value.isEmpty()) {
                JSONArray parts = message.optJSONArray("content");
                if (parts != null) {
                    StringBuilder builder = new StringBuilder();
                    for (int i = 0; i < parts.length(); i++) {
                        JSONObject part = parts.optJSONObject(i);
                        if (part != null) {
                            builder.append(part.optString("text", ""));
                        }
                    }
                    value = builder.toString();
                }
            }
            return value;
        } finally {
            connection.disconnect();
        }
    }

    private static String readAll(InputStream input) throws Exception {
        if (input == null) {
            return "";
        }
        try (InputStream stream = input;
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            int total = 0;
            while ((read = stream.read(buffer)) > 0 && total < 64_000) {
                output.write(buffer, 0, read);
                total += read;
            }
            return output.toString("UTF-8");
        }
    }

    private static String friendly(String message) {
        String lower = message == null ? "" : message.toLowerCase(Locale.ROOT);
        if (lower.contains("free quota exhausted") || lower.contains("use free tier only")) {
            return "识图失败：百炼免费额度用完，去控制台充值或关闭「仅使用免费额度」。";
        }
        if (lower.contains("401") || lower.contains("unauthorized")
                || lower.contains("invalid api key") || lower.contains("incorrect api key")) {
            return "识图失败：通义千问 Key 无效。";
        }
        if (lower.contains("402") || lower.contains("insufficient")
                || lower.contains("balance")) {
            return "识图失败：账户余额不足。";
        }
        if (lower.contains("timeout") || lower.contains("timed out")) {
            return "识图超时，请再试一次。";
        }
        if (lower.contains("model") && (lower.contains("not found")
                || lower.contains("not exist") || lower.contains("invalid"))) {
            return "识图模型不可用。";
        }
        return "识图失败：" + message;
    }
}