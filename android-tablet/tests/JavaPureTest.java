package com.piona.zhujie;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;

/**
 * 安卓端纯函数单测（普通 JVM 可跑，不用 JUnit、不用 android.jar）。
 *
 * 编译运行（在 android-tablet/ 下）：
 *   javac -encoding UTF-8 -d /tmp/zhujie-test-classes \
 *     app/src/com/piona/zhujie/UpdateLogic.java \
 *     app/src/com/piona/zhujie/UrlSafety.java \
 *     app/src/com/piona/zhujie/TokenEstimator.java \
 *     app/src/com/piona/zhujie/HttpSupport.java \
 *     app/src/com/piona/zhujie/ChipGate.java \
 *     app/src/com/piona/zhujie/BubbleWatchdog.java \
 *     tests/JavaPureTest.java
 *   java -cp /tmp/zhujie-test-classes com.piona.zhujie.JavaPureTest
 *
 * 覆盖：更新清单解析/双源取新/下载候选/相对地址解析、
 * 公网地址安全检查、token 粗估、流读取/SHA-256/网络错误归类、
 * chip 弹不弹的门控（真选区 / 扫描补漏 / 剪贴板信号）。
 */
public final class JavaPureTest {
    private static int passed;
    private static int failed;

    private static void check(String name, boolean condition) {
        if (condition) {
            passed++;
            System.out.println("PASS " + name);
        } else {
            failed++;
            System.out.println("FAIL " + name);
        }
    }

    private static void eq(String name, Object actual, Object expected) {
        check(name + "（期望=" + expected + "，实际=" + actual + "）",
                expected == null ? actual == null : expected.equals(actual));
    }

    private static ChipGate.Snapshot gateSnapshot() {
        return new ChipGate.Snapshot();
    }

    public static void main(String[] args) throws Exception {
        // ---- UpdateLogic.pickNewestCode：双源取新（U1）----
        eq("pickNewestCode 备用源更新", UpdateLogic.pickNewestCode(1016, 1017), 1017);
        eq("pickNewestCode 主源更新", UpdateLogic.pickNewestCode(1018, 1017), 1018);
        eq("pickNewestCode 一源为空", UpdateLogic.pickNewestCode(0, 1016), 1016);
        eq("pickNewestCode 两源相同", UpdateLogic.pickNewestCode(1016, 1016), 1016);

        // ---- UpdateLogic.parseManifest：直接 JSON（真实 0.1.38 清单）----
        String json = "{\"versionCode\":1016,\"versionName\":\"0.1.38\","
                + "\"url\":\"https://raw.githubusercontent.com/dolee676-sys/annotation-tool/main/android-release/zhujie-tablet-0.1.38.apk\","
                + "\"sha256\":\"5a68f96da5734544ecaaa4b3f37745ccf4cfd618161bf7d3f430d546587ad7cf\","
                + "\"size\":243595,\"notes\":\"修复更新稳定性\"}";
        UpdateLogic.Manifest direct = UpdateLogic.parseManifest(json);
        check("parseManifest 直接 JSON 不为空", direct != null);
        eq("parseManifest versionCode", direct.versionCode, 1016);
        eq("parseManifest versionName", direct.versionName, "0.1.38");
        eq("parseManifest size", direct.size, 243595L);
        check("parseManifest sha256", direct.sha256.startsWith("5a68f96d"));
        check("parseManifest 完整清单", UpdateLogic.isComplete(direct));

        // ---- UpdateLogic.parseManifest：GitHub Contents base64 包裹 ----
        String wrapped = "{\"content\":\""
                + Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8))
                + "\",\"encoding\":\"base64\"}";
        UpdateLogic.Manifest unwrapped = UpdateLogic.parseManifest(wrapped);
        check("parseManifest base64 包裹不为空", unwrapped != null);
        eq("parseManifest base64 versionCode", unwrapped.versionCode, 1016);
        eq("parseManifest base64 versionName", unwrapped.versionName, "0.1.38");

        // ---- UpdateLogic.parseManifest：非法输入 ----
        check("parseManifest null", UpdateLogic.parseManifest(null) == null);
        check("parseManifest 空串", UpdateLogic.parseManifest("   ") == null);
        check("parseManifest 乱码", UpdateLogic.parseManifest("not json at all") == null);
        UpdateLogic.Manifest missing = UpdateLogic.parseManifest(
                "{\"versionCode\":1017,\"versionName\":\"0.1.39\",\"url\":\"https://example.com/a.apk\"}");
        check("parseManifest 缺 sha256 仍解析", missing != null);
        check("parseManifest 缺 sha256 算不完整", !UpdateLogic.isComplete(missing));
        check("parseManifest null 算不完整", !UpdateLogic.isComplete(null));

        // ---- UpdateLogic.downloadCandidates：候选顺序 raw → Release → jsdelivr ----
        String[] raw = UpdateLogic.downloadCandidates(
                "https://raw.githubusercontent.com/dolee676-sys/annotation-tool/main/android-release/zhujie-tablet-0.1.39.apk",
                "0.1.39");
        eq("downloadCandidates raw 源 3 个候选", raw.length, 3);
        check("downloadCandidates 第 1 是原地址", raw[0].startsWith("https://raw.githubusercontent.com/"));
        check("downloadCandidates 第 2 是 Release 资产",
                raw[1].equals("https://github.com/dolee676-sys/annotation-tool/releases/download/android-v0.1.39/zhujie-tablet-0.1.39.apk"));
        check("downloadCandidates 第 3 是 jsdelivr", raw[2].startsWith("https://cdn.jsdelivr.net/gh/"));
        String[] plain = UpdateLogic.downloadCandidates("https://example.com/a.apk", "0.1.39");
        eq("downloadCandidates 非 raw 源 2 个候选", plain.length, 2);
        String[] noSource = UpdateLogic.downloadCandidates("", "0.1.39");
        eq("downloadCandidates 无源只剩 Release 资产", noSource.length, 1);

        // ---- UpdateLogic.resolveDownloadUrl：相对地址按 raw 解析（U6）----
        eq("resolveDownloadUrl 绝对地址不动",
                UpdateLogic.resolveDownloadUrl("https://example.com/a.apk", ""),
                "https://example.com/a.apk");
        eq("resolveDownloadUrl 相对地址拼 raw 目录",
                UpdateLogic.resolveDownloadUrl("zhujie-tablet-0.1.39.apk", ""),
                "https://raw.githubusercontent.com/dolee676-sys/annotation-tool/main/android-release/zhujie-tablet-0.1.39.apk");
        eq("resolveDownloadUrl null", UpdateLogic.resolveDownloadUrl(null, ""), "");

        // ---- UrlSafety.baseUrlError：公网只许 HTTPS（安全红线）----
        check("baseUrlError https 放行", UrlSafety.baseUrlError("https://api.deepseek.com/v1") == null);
        check("baseUrlError 公网 http 拒绝",
                UrlSafety.baseUrlError("http://api.example.com/v1") != null);
        check("baseUrlError localhost 放行",
                UrlSafety.baseUrlError("http://localhost:11434/v1") == null);
        check("baseUrlError 127.0.0.1 放行",
                UrlSafety.baseUrlError("http://127.0.0.1:8080") == null);
        check("baseUrlError 192.168 放行",
                UrlSafety.baseUrlError("http://192.168.1.5:8080") == null);
        check("baseUrlError 10.x 放行",
                UrlSafety.baseUrlError("http://10.0.0.1:8080") == null);
        check("baseUrlError 172.16 放行",
                UrlSafety.baseUrlError("http://172.16.0.1:8080") == null);
        check("baseUrlError 172.32 拒绝",
                UrlSafety.baseUrlError("http://172.32.0.1:8080") != null);
        check("baseUrlError 非 http(s) 拒绝",
                UrlSafety.baseUrlError("ftp://example.com") != null);
        check("baseUrlError null 拒绝", UrlSafety.baseUrlError(null) != null);

        // ---- TokenEstimator.estimate：中日韩 1.1、其他 1/4 ----
        eq("estimate null", TokenEstimator.estimate(null), 1);
        eq("estimate 空串", TokenEstimator.estimate(""), 1);
        eq("estimate 两个汉字", TokenEstimator.estimate("你好"), 2);
        eq("estimate 四个汉字", TokenEstimator.estimate("你好世界"), 4);
        eq("estimate 纯英文 5 字符", TokenEstimator.estimate("hello"), 1);

        // ---- HttpSupport.readAll / sha256 / networkHint ----
        eq("readAll 小流读全",
                HttpSupport.readAll(new ByteArrayInputStream("hello".getBytes(StandardCharsets.UTF_8))),
                "hello");
        eq("readAll null", HttpSupport.readAll(null), "");
        File temp = File.createTempFile("zhujie-sha-test", ".txt");
        Files.write(temp.toPath(), "abc".getBytes(StandardCharsets.UTF_8));
        eq("sha256(abc)",
                HttpSupport.sha256(temp),
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        temp.delete();
        eq("networkHint 域名解析失败", HttpSupport.networkHint("Unable to resolve host \"api.example.com\""), "HOST");
        eq("networkHint 连接被拒", HttpSupport.networkHint("failed to connect to /1.2.3.4"), "CONNECT");
        eq("networkHint 超时", HttpSupport.networkHint("Read timed out"), "TIMEOUT");
        check("networkHint 无法归类", HttpSupport.networkHint("something weird") == null);
        check("networkHint null", HttpSupport.networkHint(null) == null);

        // ---- ChipGate.hasRealRange：只有真实区间才是选区 ----
        check("hasRealRange 正常区间", ChipGate.hasRealRange(2, 5, 10));
        check("hasRealRange 光标挪动开始==结束不算", !ChipGate.hasRealRange(3, 3, 10));
        check("hasRealRange 开始<0不算", !ChipGate.hasRealRange(-1, 5, 10));
        check("hasRealRange 结束<=开始不算", !ChipGate.hasRealRange(5, 2, 10));
        check("hasRealRange 结束超长不算", !ChipGate.hasRealRange(0, 11, 10));
        check("hasRealRange 空文本不算", !ChipGate.hasRealRange(0, 0, 0));

        // ---- ChipGate.shouldShowSelection：真选区事件 ----
        long t0 = 1_000_000L;
        ChipGate.Bounds b1 = ChipGate.Bounds.of(10, 20, 100, 60);
        ChipGate.Bounds b2 = ChipGate.Bounds.of(10, 200, 100, 240);
        check("选区 新文字弹", ChipGate.shouldShowSelection("你好", b1, t0, gateSnapshot()));
        check("选区 空串不弹", !ChipGate.shouldShowSelection("   ", b1, t0, gateSnapshot()));
        check("选区 null不弹", !ChipGate.shouldShowSelection(null, b1, t0, gateSnapshot()));
        ChipGate.Snapshot dismissed = gateSnapshot();
        dismissed.dismissedText = "你好";
        dismissed.dismissedBounds = b1;
        dismissed.dismissedAt = t0;
        check("选区 刚dismiss同一段同一位置不弹",
                !ChipGate.shouldShowSelection("你好", b1, t0 + 1000, dismissed));
        check("选区 同一段过了冷却期再选弹",
                ChipGate.shouldShowSelection("你好", b1, t0 + 6000, dismissed));
        check("选区 同一段换了位置再选弹",
                ChipGate.shouldShowSelection("你好", b2, t0 + 1000, dismissed));
        ChipGate.Snapshot showing = gateSnapshot();
        showing.shownText = "你好";
        showing.shownBounds = b1;
        showing.chipShowing = true;
        check("选区 正在展示同一段不重复弹",
                !ChipGate.shouldShowSelection("你好", b1, t0, showing));
        check("选区 正在展示但换了一段弹",
                ChipGate.shouldShowSelection("世界", b2, t0, showing));
        ChipGate.Snapshot panel = gateSnapshot();
        panel.suppressChip = true;
        panel.panelText = "你好";
        check("选区 面板正展示同一段不弹",
                !ChipGate.shouldShowSelection("你好", b1, t0, panel));
        check("选区 面板展示但换了一段弹",
                ChipGate.shouldShowSelection("世界", b2, t0, panel));

        // ---- ChipGate.shouldShowScan：扫描补漏只认最近手势 ----
        ChipGate.Snapshot noGesture = gateSnapshot();
        check("扫描 没有手势旧选区不弹",
                !ChipGate.shouldShowScan("你好", b1, t0, noGesture));
        ChipGate.Snapshot freshGesture = gateSnapshot();
        freshGesture.lastGestureAt = t0;
        check("扫描 长按/切窗口后1秒新选区弹",
                ChipGate.shouldShowScan("你好", b1, t0 + 1000, freshGesture));
        check("扫描 手势6秒后旧选区不弹",
                !ChipGate.shouldShowScan("你好", b1, t0 + 6000, freshGesture));
        ChipGate.Snapshot scanDismissed = gateSnapshot();
        scanDismissed.lastGestureAt = t0;
        scanDismissed.dismissedText = "你好";
        scanDismissed.dismissedBounds = b1;
        scanDismissed.dismissedAt = t0;
        check("扫描 刚dismiss的旧选区有手势也不弹",
                !ChipGate.shouldShowScan("你好", b1, t0 + 1000, scanDismissed));
        check("扫描 空串不弹",
                !ChipGate.shouldShowScan("  ", b1, t0 + 1000, freshGesture));

        // ---- ChipGate.shouldShowClipboard：剪贴板只认最近用户复制动作 ----
        ChipGate.Snapshot clip = gateSnapshot();
        check("剪贴板 没有任何信号不弹",
                !ChipGate.shouldShowClipboard("你好", t0, clip, 0));
        check("剪贴板 1秒前点了复制弹",
                ChipGate.shouldShowClipboard("你好", t0 + 1000, clip, t0));
        check("剪贴板 信号4秒前不弹",
                !ChipGate.shouldShowClipboard("你好", t0 + 4000, clip, t0));
        check("剪贴板 空串不弹",
                !ChipGate.shouldShowClipboard(" ", t0 + 1000, clip, t0));
        ChipGate.Snapshot clipShowing = gateSnapshot();
        clipShowing.chipShowing = true;
        clipShowing.currentText = "你好";
        check("剪贴板 正在展示同一段不重复弹",
                !ChipGate.shouldShowClipboard("你好", t0 + 1000, clipShowing, t0));

        // ---- ChipGate 计时：注按钮消失慢（原来平板 8 秒自动藏 + 6 秒保护期）----
        eq("注按钮 无操作 3 秒自动消失（原来 8 秒）", ChipGate.AUTO_HIDE_MS, 3000L);
        eq("注按钮 弹出保护期 1.2 秒（原来 6 秒）", ChipGate.PROTECT_MS, 1200L);
        check("注按钮 同一段已在展示不重置计时",
                !ChipGate.shouldRearmTimer("你好", "你好"));
        check("注按钮 换了一段重置计时",
                ChipGate.shouldRearmTimer("你好", "世界"));
        check("注按钮 还没展示过重置计时",
                ChipGate.shouldRearmTimer(null, "你好"));
        check("注按钮 展示记录为空重置计时",
                ChipGate.shouldRearmTimer("", "你好"));
        check("注按钮 新选区为空重置计时",
                ChipGate.shouldRearmTimer("你好", null));
        // 扫描补漏：正在展示的同一段即使位置变了（滚动）也不再弹、不续期。
        ChipGate.Snapshot scanShowingSame = gateSnapshot();
        scanShowingSame.lastGestureAt = t0;
        scanShowingSame.chipShowing = true;
        scanShowingSame.shownText = "你好";
        scanShowingSame.shownBounds = b1;
        check("扫描 正在展示同一段、位置变了也不弹",
                !ChipGate.shouldShowScan("你好", b2, t0 + 1000, scanShowingSame));
        ChipGate.Snapshot scanNotShowing = gateSnapshot();
        scanNotShowing.lastGestureAt = t0;
        check("扫描 同一段但小框没在展示、有手势就弹",
                ChipGate.shouldShowScan("你好", b2, t0 + 1000, scanNotShowing));
        ChipGate.Snapshot scanShowingOther = gateSnapshot();
        scanShowingOther.lastGestureAt = t0;
        scanShowingOther.chipShowing = true;
        scanShowingOther.shownText = "你好";
        scanShowingOther.shownBounds = b1;
        check("扫描 正在展示但换了一段弹",
                ChipGate.shouldShowScan("世界", b2, t0 + 1000, scanShowingOther));

        // ---- BubbleWatchdog.shouldRestore：气泡丢了什么时候该找回来 ----
        check("看门狗 都正常就恢复",
                BubbleWatchdog.shouldRestore(false, false, false, false, false));
        check("看门狗 总开关关了不恢复",
                !BubbleWatchdog.shouldRestore(true, false, false, false, false));
        check("看门狗 用户亲手关了划不恢复",
                !BubbleWatchdog.shouldRestore(false, true, false, false, false));
        check("看门狗 面板开着不恢复",
                !BubbleWatchdog.shouldRestore(false, false, true, false, false));
        check("看门狗 正在拖选不恢复",
                !BubbleWatchdog.shouldRestore(false, false, false, true, false));
        check("看门狗 刚点划等截屏不恢复",
                !BubbleWatchdog.shouldRestore(false, false, false, false, true));
        check("看门狗 关了+面板开着也不恢复",
                !BubbleWatchdog.shouldRestore(true, false, true, false, false));

        System.out.println("----");
        System.out.println("通过 " + passed + "，失败 " + failed);
        if (failed > 0) {
            System.exit(1);
        }
    }
}
