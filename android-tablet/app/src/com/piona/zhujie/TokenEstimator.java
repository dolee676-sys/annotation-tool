package com.piona.zhujie;

/**
 * 从 AiClient 抽出的 token 粗估（服务端不返回 usage 时用，界面以 ≈ 标记）。
 * 中日韩字符按 1.1、其他字符按 1/4 估算，与原来完全一致。纯函数。
 */
public final class TokenEstimator {
    private TokenEstimator() {
    }

    public static int estimate(String text) {
        if (text == null) {
            return 1;
        }
        int cjk = 0;
        int other = 0;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if ((ch >= 0x3400 && ch <= 0x9FFF)
                    || (ch >= 0x3040 && ch <= 0x30FF)
                    || (ch >= 0xAC00 && ch <= 0xD7AF)) {
                cjk++;
            } else {
                other++;
            }
        }
        return Math.max(1, Math.round(cjk * 1.1f + other / 4f));
    }
}
