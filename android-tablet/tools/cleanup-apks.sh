#!/usr/bin/env bash
# 把 android-release/ 里的 APK 从 git 历史包袱中清掉的方案与演练脚本。
#
# 现状：25+ 个 APK 直接进了 git（tools/push-android-release.js 用 GitHub API
# 把 APK 以 blob 形式推上去），仓库因此变大；每次发版都要等整个 APK 上传。
# 正确做法是 APK 只作为 GitHub Release 的附件，git 里只留 latest.json，
# latest.json 的 url 指向 Release 附件地址。
#
# 本脚本默认只做 dry-run：列出会动的文件、会执行的命令，不改任何东西。
# 真正执行需要加 --apply，且必须先做完下面的第 0 步，否则更新器会 404。
#
# 前置条件（缺一不可，做完再 --apply）：
#   0. 先改 tools/make-latest.js 的默认 URL：从 raw.githubusercontent.com/…
#      /android-release/zhujie-tablet-<ver>.apk 改成
#      https://github.com/dolee676-sys/annotation-tool/releases/download/android-v<ver>/zhujie-tablet-<ver>.apk，
#      并确认新版 latest.json 已按新地址发布、平板上的更新器能正常下载。
#      在这一步完成之前，APK 绝不能离开 git（否则旧版应用找不到安装包）。
#   1. 确认每个要删的 APK 都已作为 Release 附件上传（逐个核对 SHA-256）。
#   2. 有人在本地留了一份全量备份（万一删错还能恢复）。
#
# --apply 时做的事（只删 git 索引里的 APK 文件，不动工作区文件、不改历史提交）：
#   git rm --cached android-release/*.apk
#   git commit -m "chore(android): APK 改走 Release 附件，不再进 git"
# 历史提交里的 APK 不会因此消失（改历史要重写所有提交，风险大、不做）；
# 新克隆会变小，旧历史占用的空间随时间自然淘汰。
#
# 另：以后发版不要再把 APK 推到 android-release/ 目录下；
# push-android-release.js 已支持 --release-only（只建 Release 不推 git）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

APPLY=0
if [ "${1:-}" = "--apply" ]; then
  APPLY=1
elif [ -n "${1:-}" ]; then
  echo "用法：bash android-tablet/tools/cleanup-apks.sh [--apply]（默认只演练）" >&2
  exit 1
fi

echo "== android-release/ 里的 APK（git 索引中）=="
git ls-files android-release/ | grep -E '\.apk$' || true
echo
echo "== 总大小 =="
git ls-files android-release/ | grep -E '\.apk$' | xargs -r du -ch 2>/dev/null | tail -1 || true
echo
echo "== latest.json 当前的 url（第 0 步改完前必须是 raw 地址，改完后是 releases/download 地址）=="
grep -o '"url": *"[^"]*"' android-release/latest.json || true
echo

if [ "$APPLY" -eq 0 ]; then
  echo "dry-run：上面是会动的文件，没有改任何东西。"
  echo "确认前置第 0 步（make-latest.js 改 Release 地址并验证更新器能下载）已完成，"
  echo "再执行：bash android-tablet/tools/cleanup-apks.sh --apply"
  exit 0
fi

echo "== --apply：从 git 索引移除 APK（工作区文件不动，历史提交不动）=="
FILES="$(git ls-files android-release/ | grep -E '\.apk$' || true)"
if [ -z "$FILES" ]; then
  echo "索引里已经没有 APK，不用删。"
  exit 0
fi
echo "$FILES" | xargs git rm --cached
echo
echo "下一步（请手动确认后执行）："
echo "  git commit -m \"chore(android): APK 改走 Release 附件，不再进 git\""
echo "  git push"
