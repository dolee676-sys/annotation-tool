#!/usr/bin/env bash
# 版本号双写校验：build.sh 与 AndroidManifest.xml 必须一致。
# 版本的唯一来源是 android-tablet/build.sh 里的 VERSION_CODE / VERSION_NAME；
# 改版时只改那里，再同步 Manifest（下个发布版由 Rick 定 0.1.39/1017）。
# 用法：bash tools/check-version.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_SH="$ROOT/android-tablet/build.sh"
MANIFEST="$ROOT/android-tablet/app/AndroidManifest.xml"

code_sh="$(grep -E '^VERSION_CODE=' "$BUILD_SH" | cut -d= -f2)"
name_sh="$(grep -E '^VERSION_NAME=' "$BUILD_SH" | cut -d= -f2)"
code_mf="$(grep -o 'android:versionCode="[0-9]*"' "$MANIFEST" | grep -o '[0-9]*')"
name_mf="$(grep -o 'android:versionName="[^"]*"' "$MANIFEST" | cut -d'"' -f2)"

fail=0
if [ "$code_sh" != "$code_mf" ]; then
  echo "错误：versionCode 不一致：build.sh=$code_sh，AndroidManifest.xml=$code_mf" >&2
  fail=1
fi
if [ "$name_sh" != "$name_mf" ]; then
  echo "错误：versionName 不一致：build.sh=$name_sh，AndroidManifest.xml=$name_mf" >&2
  fail=1
fi
if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "版本一致：$name_sh ($code_sh)"
