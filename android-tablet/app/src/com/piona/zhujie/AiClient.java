package com.piona.zhujie;

import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public final class AiClient {
    private static final Map<String, HttpURLConnection> ACTIVE = new ConcurrentHashMap<>();
    private static final Map<String, WebView> OWNER = new ConcurrentHashMap<>();
    private static final Set<String> CANCELLED =
            Collections.newSetFromMap(new ConcurrentHashMap<String, Boolean>());

    private AiClient() {
    }

    public static void chat(WebView web, String requestJson, String callbackId) {
        if (web != null) {
            OWNER.put(callbackId, web);
        }
        Thread thread = new Thread(
                () -> run(web, requestJson, callbackId), "zhujie-ai");
        thread.start();
    }

    public static void cancel(String callbackId) {
        if (callbackId == null) {
            return;
        }
        CANCELLED.add(callbackId);
        HttpURLConnection connection = ACTIVE.remove(callbackId);
        if (connection != null) {
            try {
                connection.disconnect();
            } catch (Exception ignored) {
            }
        }
        // 补发终止回调，避免界面停在「正在回答」；保留已生成内容。
        WebView owner = OWNER.get(callbackId);
        if (owner != null) {
            try {
                JSONObject usage = new JSONObject();
                usage.put("stopped", true);
                usage.put("promptTokens", 0);
                usage.put("completionTokens", 0);
                usage.put("totalTokens", 0);
                usage.put("estimated", true);
                emitDone(owner, callbackId, usage);
            } catch (Exception ignored) {
            }
        }
    }

    /** 只取消某个窗口（WebView）自己的请求，不影响其他窗口。 */
    public static void cancelOwner(WebView owner) {
        if (owner == null) {
            return;
        }
        for (Map.Entry<String, WebView> entry : OWNER.entrySet()) {
            if (entry.getValue() == owner) {
                cancel(entry.getKey());
            }
        }
    }

    private static void run(WebView web, String requestJson, String callbackId) {
        if (CANCELLED.contains(callbackId)) {
            return;
        }
        long started = System.currentTimeMillis();
        HttpURLConnection connection = null;
        try {
            JSONObject request = new JSONObject(requestJson);
            String baseUrl = request.optString("baseUrl", "").trim();
            while (baseUrl.endsWith("/")) {
                baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
            }
            if (baseUrl.isEmpty()) {
                emitError(web, callbackId, "还没有配置模型地址。");
                return;
            }
            String urlError = baseUrlError(baseUrl);
            if (urlError != null) {
                emitError(web, callbackId, urlError);
                return;
            }
            String apiKey = request.optString("apiKey", "").trim();
            String model = request.optString("model", "").trim();
            if (model.isEmpty()) {
                emitError(web, callbackId, "还没有选择模型。");
                return;
            }

            JSONObject body = new JSONObject();
            body.put("model", model);
            body.put("stream", true);
            body.put("temperature", request.optDouble("temperature", 0.3));
            JSONArray messages = new JSONArray();
            messages.put(new JSONObject()
                    .put("role", "system")
                    .put("content", request.optString("system", "")));
            messages.put(new JSONObject()
                    .put("role", "user")
                    .put("content", request.optString("user", "")));
            body.put("messages", messages);

            connection = (HttpURLConnection) new URL(baseUrl + "/chat/completions").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(120_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "text/event-stream");
            if (!apiKey.isEmpty()) {
                connection.setRequestProperty("Authorization", "Bearer " + apiKey);
            }
            ACTIVE.put(callbackId, connection);

            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                String raw = readAll(connection.getErrorStream());
                emitError(web, callbackId, friendly(extractError(raw, status)));
                return;
            }

            StringBuilder answer = new StringBuilder();
            int promptTokens = 0;
            int completionTokens = 0;
            int totalTokens = 0;
            boolean hasUsage = false;
            String error = null;

            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (CANCELLED.contains(callbackId)) {
                        return;
                    }
                    String trimmed = line.trim();
                    if (trimmed.isEmpty() || !trimmed.startsWith("data:")) {
                        continue;
                    }
                    String payload = trimmed.substring(5).trim();
                    if (payload.isEmpty() || "[DONE]".equals(payload)) {
                        continue;
                    }
                    try {
                        JSONObject chunk = new JSONObject(payload);
                        JSONObject errorObject = chunk.optJSONObject("error");
                        if (errorObject != null) {
                            String message = errorObject.optString("message", "");
                            if (!message.isEmpty()) {
                                error = message;
                                break;
                            }
                        }
                        JSONArray choices = chunk.optJSONArray("choices");
                        if (choices != null && choices.length() > 0) {
                            JSONObject choice = choices.optJSONObject(0);
                            String piece = "";
                            if (choice != null) {
                                JSONObject delta = choice.optJSONObject("delta");
                                if (delta != null) {
                                    piece = delta.optString("content", "");
                                }
                                if (piece.isEmpty()) {
                                    JSONObject message = choice.optJSONObject("message");
                                    if (message != null) {
                                        piece = message.optString("content", "");
                                    }
                                }
                            }
                            if (!piece.isEmpty()) {
                                answer.append(piece);
                                emitDelta(web, callbackId, piece);
                            }
                        }
                        JSONObject usage = chunk.optJSONObject("usage");
                        if (usage != null) {
                            promptTokens = usage.optInt("prompt_tokens", 0);
                            completionTokens = usage.optInt("completion_tokens", 0);
                            totalTokens = usage.optInt("total_tokens", 0);
                            hasUsage = true;
                        }
                    } catch (Exception ignored) {
                    }
                }
            }

            if (CANCELLED.contains(callbackId)) {
                return;
            }
            if (error != null && answer.length() == 0) {
                emitError(web, callbackId, friendly(error));
                return;
            }
            if (answer.length() == 0) {
                emitError(web, callbackId, "模型没有返回可显示的内容。");
                return;
            }

            boolean estimated = !hasUsage;
            if (estimated) {
                promptTokens = estimate(request.optString("system", "")
                        + "\n" + request.optString("user", ""));
                completionTokens = estimate(answer.toString());
                totalTokens = promptTokens + completionTokens;
            }

            JSONObject done = new JSONObject();
            done.put("promptTokens", promptTokens);
            done.put("completionTokens", completionTokens);
            done.put("totalTokens", totalTokens);
            done.put("estimated", estimated);
            done.put("latencyMs", System.currentTimeMillis() - started);
            emitDone(web, callbackId, done);
        } catch (Exception exception) {
            if (!CANCELLED.contains(callbackId)) {
                emitError(web, callbackId, friendly(exception.getMessage()));
            }
        } finally {
            CANCELLED.remove(callbackId);
            ACTIVE.remove(callbackId);
            OWNER.remove(callbackId);
            if (connection != null) {
                try {
                    connection.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }

    /**
     * S-02：公网必须 HTTPS；HTTP 仅允许本机/私有网段，避免 Key 与截图明文外传。
     * 实现已抽到 UrlSafety（可单测），这里只保留调用点，行为不变。
     */
    public static String baseUrlError(String base) {
        return UrlSafety.baseUrlError(base);
    }

    private static String readAll(InputStream stream) {
        return HttpSupport.readAll(stream, 8_000);
    }

    private static String extractError(String raw, int status) {
        String text = raw == null ? "" : raw.trim();
        if (!text.isEmpty()) {
            try {
                JSONObject json = new JSONObject(text);
                JSONObject error = json.optJSONObject("error");
                if (error != null) {
                    String message = error.optString("message", "");
                    if (!message.isEmpty()) {
                        return message;
                    }
                }
                String message = json.optString("message", "");
                if (!message.isEmpty()) {
                    return message;
                }
            } catch (Exception ignored) {
            }
            return text.length() > 400 ? text.substring(0, 400) : text;
        }
        return "HTTP " + status;
    }

    private static String friendly(String message) {
        String value = message == null ? "" : message.trim();
        if (value.isEmpty()) {
            return "请求失败，请检查网络和 Key。";
        }
        String hint = HttpSupport.networkHint(value);
        if ("HOST".equals(hint)) {
            return "网络不可用，或模型地址无法解析。";
        }
        if ("TIMEOUT".equals(hint)) {
            return "请求超时，请稍后再试。";
        }
        String lower = value.toLowerCase();
        if (lower.contains("401")
                || lower.contains("unauthorized")
                || lower.contains("invalid api key")
                || lower.contains("incorrect api key")
                || lower.contains("invalid_api_key")) {
            return "API Key 无效或已过期。";
        }
        if (lower.contains("402")
                || lower.contains("insufficient")
                || lower.contains("balance")) {
            return "账户余额不足，请先充值。";
        }
        if (lower.contains("free quota exhausted") || lower.contains("use free tier only")) {
            return "免费额度已用完：请去百炼控制台充值，或关闭「仅使用免费额度」模式。";
        }
        if (lower.contains("429") || lower.contains("rate limit")) {
            return "请求太频繁，等一会儿再试。";
        }
        if (lower.contains("model") && (lower.contains("not found") || lower.contains("not exist"))) {
            return "这个模型名不可用，换一个模型试试。";
        }
        return value;
    }

    private static int estimate(String text) {
        return TokenEstimator.estimate(text);
    }

    private static void emitDelta(WebView web, String id, String piece) {
        emit(web, "window.__aiDelta(" + JSONObject.quote(id) + ","
                + JSONObject.quote(piece) + ");");
    }

    private static void emitDone(WebView web, String id, JSONObject usage) {
        emit(web, "window.__aiDone(" + JSONObject.quote(id) + "," + usage + ");");
    }

    private static void emitError(WebView web, String id, String message) {
        if (CANCELLED.contains(id)) {
            return;
        }
        emit(web, "window.__aiError(" + JSONObject.quote(id) + ","
                + JSONObject.quote(message) + ");");
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
