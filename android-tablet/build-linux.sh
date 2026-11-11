#!/usr/bin/env bash
# Linux build for the annotation-tool Android tablet end.
# Mirrors android-tablet/build.sh (Windows) step by step, with Linux-only changes:
#   - aapt2 / zipalign without .exe; Linux SDK paths
#   - tools/pack.ps1 (PowerShell) replaced by tools/pack.py (python3 zipfile)
#   - signing: see "签名" below.
#
# Run from the repo root or anywhere:
#   bash android-tablet/build-linux.sh
#
# Requires: JDK 17, Android SDK (build-tools 35.0.0, platform android-35),
#   node, python3. ANDROID_HOME defaults to $HOME/android-sdk.
#   CI installs the SDK with curl; see .github/workflows/android.yml.
#
# 签名（重要）：
#   默认用本地测试 keystore（android-tablet/.test-keystore/，首次构建时
#   自动生成，600 权限，gitignore，不会进仓库）。测试签名的包无法覆盖
#   安装平板上已有的正式版，也无法被它的应用内更新接受——这只是编译验证。
#   要编出能被已装应用接受的包，用 Rick Windows 机器上的原 keystore：
#     ZJ_KEYSTORE=/path/to/zhujie.jks \
#     ZJ_KEYSTORE_PASS_FILE=/path/to/password.txt \
#     ZJ_KEY_ALIAS=zhujie \
#     bash android-tablet/build-linux.sh
#   密码只从 600 权限的文件读，绝不写进命令行、日志或仓库。
#   构建结束会打印签名者 SHA-256 指纹，请与平板上已装应用的指纹比对
#   （见 OPTIMIZATION_REPORT.md 签名一节的验证命令）。
set -euo pipefail

TABLET_DIR="$(cd "$(dirname "$0")" && pwd)"
JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
SDK="${ANDROID_HOME:-$HOME/android-sdk}"
BT="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"

AAPT2="$BT/aapt2"
ZIPALIGN="$BT/zipalign"
APKSIGNER="$BT/lib/apksigner.jar"
D8_JAR="$BT/lib/d8.jar"

# Version is read from the project's own build.sh (single source of truth).
VERSION_CODE="$(grep -E '^VERSION_CODE=' "$TABLET_DIR/build.sh" | cut -d= -f2)"
VERSION_NAME="$(grep -E '^VERSION_NAME=' "$TABLET_DIR/build.sh" | cut -d= -f2)"
BUILD_NOTES="$(grep -E '^NOTES=' "$TABLET_DIR/build.sh" | sed 's/^NOTES="//; s/"$//')"
# 测试签名时写明不可覆盖安装；外部原 keystore 编包时用 build.sh 的正式备注。
if [ -n "${ZJ_KEYSTORE:-}" ]; then
  NOTES="$BUILD_NOTES"
else
  NOTES="Linux 本地测试构建（测试签名，不可用于覆盖安装线上版）"
fi

export PATH="$JAVA_HOME/bin:$PATH"

cd "$TABLET_DIR"

if [ ! -f "$PLATFORM" ]; then
  echo "缺少 Android platform: $PLATFORM" >&2
  echo "装 SDK：见 .github/workflows/android.yml 里的 curl 安装步骤，" >&2
  echo "或设 ANDROID_HOME 指向已有 SDK。" >&2
  exit 1
fi
if [ ! -f "$APKSIGNER" ]; then
  echo "缺少 apksigner: $APKSIGNER" >&2
  exit 1
fi

# ---- 签名 keystore 选择 ----
# 外部 keystore（Rick 的原 keystore）优先；否则用本地测试 keystore。
if [ -n "${ZJ_KEYSTORE:-}" ]; then
  KS="$ZJ_KEYSTORE"
  KS_ALIAS="${ZJ_KEY_ALIAS:-zhujie}"
  if [ -z "${ZJ_KEYSTORE_PASS_FILE:-}" ] || [ ! -f "$ZJ_KEYSTORE_PASS_FILE" ]; then
    echo "错误：已指定 ZJ_KEYSTORE，但未指定可读的 ZJ_KEYSTORE_PASS_FILE。" >&2
    echo "密码必须放在 600 权限的文件里，不要写进命令行或环境变量。" >&2
    exit 1
  fi
  if [ ! -f "$KS" ]; then
    echo "错误：找不到 ZJ_KEYSTORE=$KS" >&2
    exit 1
  fi
  KS_PASS_FILE="$ZJ_KEYSTORE_PASS_FILE"
  KS_LABEL="外部 keystore（$KS）"
else
  KS_DIR="$TABLET_DIR/.test-keystore"
  KS="$KS_DIR/zhujie-test.jks"
  KS_ALIAS="zhujie-test"
  KS_PASS_FILE="$KS_DIR/password.txt"
  KS_LABEL="测试 keystore（仅本地验证用）"
  if [ ! -f "$KS" ]; then
    mkdir -p "$KS_DIR"
    PASS="$(openssl rand -hex 16)"
    printf '%s' "$PASS" > "$KS_PASS_FILE"
    chmod 600 "$KS_PASS_FILE"
    keytool -genkeypair \
      -keystore "$KS" \
      -alias "$KS_ALIAS" \
      -keyalg RSA \
      -keysize 2048 \
      -validity 3650 \
      -storepass "$PASS" \
      -keypass "$PASS" \
      -dname "CN=Zhujie Test, O=Local Build, C=CN" \
      -storetype PKCS12 >/dev/null 2>&1
    echo "已生成测试 keystore: $KS（仅本地验证用）"
  fi
fi

rm -rf build
mkdir -p build/gen build/classes build/dex

echo "[1/7] 编译资源"
"$AAPT2" compile --dir app/res -o build/res.zip

echo "[2/7] 链接 APK 与资源"
"$AAPT2" link \
  -o build/base.apk \
  -I "$PLATFORM" \
  --manifest app/AndroidManifest.xml \
  -R build/res.zip \
  --java build/gen \
  --auto-add-overlay \
  --min-sdk-version 26 \
  --target-sdk-version 34 \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME"

echo "[3/7] 编译 Java"
find app/src build/gen -name '*.java' > build/sources.txt
javac -J-Xmx768m -encoding UTF-8 --release 11 -classpath "$PLATFORM" \
  -d build/classes @build/sources.txt

echo "[4/7] 转换为 dex"
java -Xmx1g -cp "$D8_JAR" com.android.tools.r8.D8 \
  --lib "$PLATFORM" \
  --min-api 26 \
  --output build/dex \
  $(find build/classes -name '*.class' | tr '\n' ' ')

echo "[5/7] 打包 dex 与 assets（python3 替代 pack.ps1）"
python3 "$TABLET_DIR/tools/pack.py" build/base.apk build/dex/classes.dex app/assets

echo "[6/7] 对齐"
"$ZIPALIGN" -f -p 4 build/base.apk build/aligned.apk

echo "[7/7] 签名（$KS_LABEL）"
PASS="$(cat "$KS_PASS_FILE")"
java -Xmx512m --enable-native-access=ALL-UNNAMED -jar "$APKSIGNER" sign \
  --ks "$KS" \
  --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$PASS" \
  --key-pass "pass:$PASS" \
  --out build/zhujie-tablet.apk \
  build/aligned.apk

java -Xmx512m --enable-native-access=ALL-UNNAMED -jar "$APKSIGNER" verify --print-certs \
  build/zhujie-tablet.apk > build/verify.txt 2>&1 || { cat build/verify.txt; exit 1; }

SIZE="$(stat -c '%s' build/zhujie-tablet.apk)"
cp build/zhujie-tablet.apk "build/zhujie-tablet-$VERSION_NAME.apk"
node tools/make-latest.js build/zhujie-tablet.apk "$VERSION_CODE" "$VERSION_NAME" "$NOTES"

echo
echo "完成: $TABLET_DIR/build/zhujie-tablet.apk"
echo "版本: $VERSION_NAME ($VERSION_CODE)"
echo "大小: $((SIZE / 1024)) KB"
sha256sum build/zhujie-tablet.apk | tee build/zhujie-tablet.apk.sha256
echo "更新清单: $TABLET_DIR/build/latest.json"
grep "SHA-256 digest" build/verify.txt || head -5 build/verify.txt
if [ -z "${ZJ_KEYSTORE:-}" ]; then
  echo "注意：这是测试签名，无法覆盖安装平板上的正式版，也无法被它的应用内更新接受。"
fi
