#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-D:/dev/sdk/android-sdk}"
BT="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"

AAPT2="$BT/aapt2.exe"
ZIPALIGN="$BT/zipalign.exe"
APKSIGNER="$BT/lib/apksigner.jar"
D8_JAR="$BT/lib/d8.jar"

# versionCode 必须单调递增（Android 只安装比已装更大的 versionCode）。
# 不要按 versionName 生成小数字（如 25），否则会低于已装的 1000+ 导致更新失败。
# 当前从 1000 起手动递增：1000=0.1.22, 1001=0.1.23, 1002=0.1.24, 1003=0.1.25, 1004=0.1.26, 1005=0.1.27, 1006=0.1.28, 1007=0.1.29, 1008=0.1.30, 1009=0.1.31, 1010=0.1.32, 1011=0.1.33, 1012=0.1.34, 1013=0.1.35, 1014=0.1.36, 1015=0.1.37, 1016=0.1.38 ...
VERSION_CODE=1021
VERSION_NAME=0.1.43
NOTES="首页改宽屏两栏（问候/开始阅读/统计 + 最近注解卡片）；钉住面板不再抢键盘焦点（OneNote 能正常回车）；复制请用面板内「复制」按钮。"

cd "$ROOT"

if [ ! -f "$PLATFORM" ]; then
  echo "缺少 Android platform: $PLATFORM" >&2
  exit 1
fi
if [ ! -f "$APKSIGNER" ]; then
  echo "缺少 apksigner: $APKSIGNER" >&2
  exit 1
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
javac -encoding UTF-8 --release 11 -classpath "$PLATFORM" \
  -d build/classes @build/sources.txt

echo "[4/7] 转换为 dex"
java -cp "$D8_JAR" com.android.tools.r8.D8 \
  --lib "$PLATFORM" \
  --min-api 26 \
  --output build/dex \
  $(find build/classes -name '*.class' | tr '\n' ' ')

echo "[5/7] 打包 dex 与 assets"
powershell -NoProfile -ExecutionPolicy Bypass -File tools/pack.ps1 \
  -Apk build/base.apk -Dex build/dex/classes.dex -Assets app/assets

echo "[6/7] 对齐"
"$ZIPALIGN" -f -p 4 build/base.apk build/aligned.apk

echo "[7/7] 签名"
# 签名连续性守卫：keystore 丢了就等于丢了已装应用的更新资格，
# 绝不能悄悄生成一个新 keystore 蒙混过去。
# 首次在新机器上建 keystore 时，显式加 ALLOW_NEW_KEYSTORE=1 才生成。
if [ ! -f keystore/zhujie.jks ]; then
  if [ "${ALLOW_NEW_KEYSTORE:-0}" != "1" ]; then
    echo "错误：找不到 keystore/zhujie.jks。" >&2
    echo "这个 keystore 是已装应用的签名，丢了它，新编的包就无法覆盖安装、" >&2
    echo "平板上的应用内更新也会被拒绝（签名不一致）。" >&2
    echo "如果你确实是在新机器上第一次建 keystore，用原 keystore 恢复它；" >&2
    echo "确认要新建一个（旧应用将无法直接更新，须先备份再卸载重装）时，" >&2
    echo "再显式执行：ALLOW_NEW_KEYSTORE=1 bash build.sh" >&2
    exit 1
  fi
  mkdir -p keystore
  PASS="$(openssl rand -hex 16)"
  printf '%s' "$PASS" > keystore/password.txt
  chmod 600 keystore/password.txt
  keytool -genkeypair \
    -keystore keystore/zhujie.jks \
    -alias zhujie \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass "$PASS" \
    -keypass "$PASS" \
    -dname "CN=Zhujie, O=Piona, C=CN" \
    -storetype PKCS12 >/dev/null 2>&1
  echo "已新建 keystore（新签名！旧应用无法直接更新，见 OPTIMIZATION_REPORT.md 签名一节）"
fi
PASS="$(cat keystore/password.txt)"
java --enable-native-access=ALL-UNNAMED -jar "$APKSIGNER" sign \
  --ks keystore/zhujie.jks \
  --ks-pass "pass:$PASS" \
  --key-pass "pass:$PASS" \
  --out build/zhujie-tablet.apk \
  build/aligned.apk

java --enable-native-access=ALL-UNNAMED -jar "$APKSIGNER" verify --print-certs \
  build/zhujie-tablet.apk > build/verify.txt 2>&1

SIZE="$(stat -c '%s' build/zhujie-tablet.apk)"
cp build/zhujie-tablet.apk "build/zhujie-tablet-$VERSION_NAME.apk"
node tools/make-latest.js build/zhujie-tablet.apk "$VERSION_CODE" "$VERSION_NAME" "$NOTES"

echo
echo "完成: $ROOT/build/zhujie-tablet.apk"
echo "版本: $VERSION_NAME ($VERSION_CODE)"
echo "大小: $((SIZE / 1024)) KB"
sha256sum build/zhujie-tablet.apk | tee build/zhujie-tablet.apk.sha256
echo "更新清单: $ROOT/build/latest.json"
head -5 build/verify.txt
