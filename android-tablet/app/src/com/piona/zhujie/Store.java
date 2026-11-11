package com.piona.zhujie;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class Store {
    private static final String PREF = "zhujie_store";
    private static final String ENC_PREFIX = "enc1:";
    private static final String KEY_ALIAS = "zhujie_settings_key";

    private Store() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    public static synchronized String get(Context context, String key, String fallback) {
        String raw = prefs(context).getString(key, fallback);
        if ("settings".equals(key)) {
            String decrypted = decryptSetting(raw);
            return decrypted == null ? fallback : decrypted;
        }
        return raw;
    }

    public static synchronized void put(Context context, String key, String value) {
        String stored = "settings".equals(key) ? encryptSetting(value) : value;
        prefs(context).edit().putString(key, stored).apply();
    }

    /** 设置（含 API Key）用 Android Keystore 的 AES-GCM 密钥加密落盘；失败时退回明文，保证不锁死。 */
    private static SecretKey settingKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return (SecretKey) ks.getKey(KEY_ALIAS, null);
        }
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build();
        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(spec);
        return generator.generateKey();
    }

    private static String encryptSetting(String plain) {
        if (plain == null) {
            return null;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, settingKey());
            byte[] iv = cipher.getIV();
            byte[] ct = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return ENC_PREFIX + Base64.encodeToString(iv, Base64.NO_WRAP)
                    + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
        } catch (Exception exception) {
            return plain;
        }
    }

    private static String decryptSetting(String value) {
        if (value == null || !value.startsWith(ENC_PREFIX)) {
            return value; // 旧明文直接读，下次 put 时自动加密
        }
        try {
            String[] parts = value.substring(ENC_PREFIX.length()).split(":");
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] ct = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, settingKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(ct), StandardCharsets.UTF_8);
        } catch (Exception exception) {
            return null;
        }
    }

    public static synchronized JSONArray array(Context context, String key) {
        try {
            return new JSONArray(prefs(context).getString(key, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    public static synchronized void append(Context context, String key, String json, int max) {
        try {
            JSONArray current = array(context, key);
            JSONArray next = new JSONArray();
            next.put(new JSONObject(json));
            for (int i = 0; i < current.length() && i < max - 1; i++) {
                next.put(current.get(i));
            }
            put(context, key, next.toString());
        } catch (Exception ignored) {
        }
    }

    public static synchronized void removeById(Context context, String key, String id) {
        try {
            JSONArray current = array(context, key);
            JSONArray next = new JSONArray();
            for (int i = 0; i < current.length(); i++) {
                JSONObject item = current.optJSONObject(i);
                if (item == null || !id.equals(item.optString("id"))) {
                    next.put(current.get(i));
                }
            }
            put(context, key, next.toString());
        } catch (Exception ignored) {
        }
    }

    public static synchronized void updateFavorite(Context context, String json) {
        try {
            JSONObject item = new JSONObject(json);
            String id = item.optString("id");
            JSONArray current = array(context, "favorites");
            JSONArray next = new JSONArray();
            boolean replaced = false;
            for (int i = 0; i < current.length(); i++) {
                JSONObject existing = current.optJSONObject(i);
                if (existing != null && id.equals(existing.optString("id"))) {
                    next.put(item);
                    replaced = true;
                } else {
                    next.put(current.get(i));
                }
            }
            if (replaced) {
                put(context, "favorites", next.toString());
            }
        } catch (Exception ignored) {
        }
    }

    public static synchronized void clearRecords(Context context) {
        put(context, "history", "[]");
        put(context, "favorites", "[]");
        put(context, "usage", "[]");
    }
}
