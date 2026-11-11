#!/usr/bin/env node
/**
 * 桌面端 ↔ 安卓端模型数据同步校验。
 *
 * 背景：提示词常量、模型价目原来在桌面端（src/shared/pricing.ts、
 * src/main/prompt.ts、src/shared/types.ts、src/shared/presets.ts）
 * 和安卓端（android-tablet/app/assets/js/presets.js、prompt.js）
 * 各存一份，改一边忘一边就会漂移。shared/model-data.json 是第三份
 * 记录：三方必须一致，否则本脚本失败，CI 也失败。
 *
 * 用法：
 *   node tools/sync-model-data.js            # 校验（CI 跑这个）
 *   node tools/sync-model-data.js --write    # 改完代码后刷新快照
 *
 * 改价目/提示词的流程：两边代码一起改 → 跑 --write 刷新
 * shared/model-data.json → 一起提交。只改一边时，校验会失败并
 * 指出哪一边、哪一项不一致。
 *
 * 有意保留的差异（不校验相等，只记录在 model-data.json 的 knownDrift 里，
 * 统一与否由 Rick 定，不悄悄改）：
 * 1. 默认提示词：桌面端是 3 行短版，安卓端是 389 字长版；
 * 2. qwen 模型列表：安卓端是百炼扩充后的长列表，桌面端是短列表；
 * 3. 本机模型：桌面端有 ollama/lmstudio，安卓端没有（平板版固定云端）。
 * 预设的 name/baseUrl、价目、提示词常量（SAFETY_PREFIX 等 10 个）
 * 必须三方一致；模型列表只警告、不失败。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'shared', 'model-data.json');

const DESKTOP_PRICING = path.join(ROOT, 'src', 'shared', 'pricing.ts');
const DESKTOP_PROMPT = path.join(ROOT, 'src', 'main', 'prompt.ts');
const DESKTOP_TYPES = path.join(ROOT, 'src', 'shared', 'types.ts');
const DESKTOP_PRESETS = path.join(ROOT, 'src', 'shared', 'presets.ts');
const ANDROID_PRESETS = path.join(ROOT, 'android-tablet', 'app', 'assets', 'js', 'presets.js');
const ANDROID_PROMPT = path.join(ROOT, 'android-tablet', 'app', 'assets', 'js', 'prompt.js');

const PROMPT_CONSTANTS = [
  'ASK_SYSTEM_PROMPT',
  'QUESTION_ANNOTATE_PROMPT',
  'PARAGRAPH_OVERRIDE',
  'SAFETY_PREFIX',
  'FOCUS_WORD_PREFIX',
  'FOCUS_PARAGRAPH_PREFIX',
  'FOCUS_QUESTION_PREFIX',
  'FOCUS_ASK_PREFIX',
  'CONTEXT_ANNOTATE_PREFIX',
  'CONTEXT_ASK_PREFIX',
];

const read = (p) => fs.readFileSync(p, 'utf8');

/** 把 JS/TS 字符串字面量（单引号或反引号）解码成实际值。 */
function decodeJsString(raw) {
  return raw.replace(/\\(\\|n|r|t|'|"|`|u[0-9a-fA-F]{4})/g, (m, esc) => {
    if (esc === 'n') return '\n';
    if (esc === 'r') return '\r';
    if (esc === 't') return '\t';
    if (esc === '\\') return '\\';
    if (esc === "'") return "'";
    if (esc === '"') return '"';
    if (esc === '`') return '`';
    if (esc.startsWith('u')) return String.fromCharCode(parseInt(esc.slice(1), 16));
    return m;
  });
}

/** 从源码里取 `NAME = '...' / `...`` 形式的字符串常量。 */
function extractStringConstant(source, name) {
  const re = new RegExp(
    '(?:const|var)\\s+' + name + '\\s*=\\s*(`(?:[^`\\\\]|\\\\.)*?`|"(?:[^"\\\\]|\\\\.)*?"|\'(?:[^\'\\\\]|\\\\.)*?\')',
  );
  const m = source.match(re);
  if (!m) return null;
  const literal = m[1];
  return decodeJsString(literal.slice(1, -1));
}

/** pricing.ts 里的 'model': { in: x, out: y }。 */
function extractPricesTs(source) {
  const out = {};
  const re = /'([^']+)':\s*\{\s*in:\s*([0-9.]+),\s*out:\s*([0-9.]+)\s*\}/g;
  let m;
  while ((m = re.exec(source))) {
    out[m[1]] = { in: Number(m[2]), out: Number(m[3]) };
  }
  return out;
}

/** presets.ts 里每个预设的 id/name/baseUrl/models（只取这四项）。 */
function extractPresetsTs(source) {
  const out = {};
  const blocks = source.split(/\{\s*id:\s*'/).slice(1);
  for (const block of blocks) {
    const id = block.slice(0, block.indexOf("'"));
    const name = (block.match(/name:\s*'([^']+)'/) || [])[1];
    const baseUrl = (block.match(/baseUrl:\s*'([^']+)'/) || [])[1];
    const modelsBlock = (block.match(/models:\s*\[([\s\S]*?)\]/) || [])[1] || '';
    const models = [...modelsBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    if (id) out[id] = { name, baseUrl, models };
  }
  return out;
}

/** 在 vm 沙箱里加载安卓端 presets.js，拿到 ZJ_PRICES / ZJ_PRESETS / ZJ_DEFAULT_PROMPT。 */
function loadAndroidPresets() {
  const sandbox = { console, Map, JSON };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read(ANDROID_PRESETS), sandbox, { filename: 'presets.js' });
  return {
    prices: sandbox.window.ZJ_PRICES,
    presets: sandbox.window.ZJ_PRESETS,
    defaultPrompt: sandbox.window.ZJ_DEFAULT_PROMPT,
  };
}

function collect() {
  const desktopPricing = read(DESKTOP_PRICING);
  const desktopPrompt = read(DESKTOP_PROMPT);
  const desktopTypes = read(DESKTOP_TYPES);
  const desktopPresets = read(DESKTOP_PRESETS);
  const androidPrompt = read(ANDROID_PROMPT);
  const android = loadAndroidPresets();

  const promptConstants = {};
  for (const name of PROMPT_CONSTANTS) {
    promptConstants[name] = {
      desktop: extractStringConstant(desktopPrompt, name),
      android: extractStringConstant(androidPrompt, name),
    };
  }
  return {
    prices: {
      desktop: extractPricesTs(desktopPricing),
      android: android.prices,
    },
    promptConstants,
    defaultPrompts: {
      desktop: extractStringConstant(desktopTypes, 'DEFAULT_PROMPT'),
      android: android.defaultPrompt,
    },
    presets: {
      desktop: extractPresetsTs(desktopPresets),
      android: Object.fromEntries(
        android.presets.map((p) => [p.id, { name: p.name, baseUrl: p.baseUrl, models: p.models }]),
      ),
    },
  };
}

function main() {
  const write = process.argv.includes('--write');
  const data = collect();
  const errors = [];
  const warnings = [];

  if (write) {
    const snapshot = {
      _readme:
        '桌面端与安卓端模型数据的同步快照。校验规则见 tools/sync-model-data.js：'
        + '价目、提示词常量、预设 name/baseUrl 必须三方一致；'
        + '默认提示词与 qwen 模型列表的差异是有意保留的（见 knownDrift），统一与否由 Rick 定。',
      prices: data.prices.desktop,
      promptConstants: Object.fromEntries(
        Object.entries(data.promptConstants).map(([k, v]) => [k, v.desktop]),
      ),
      defaultPrompts: data.defaultPrompts,
      presets: Object.fromEntries(
        Object.entries(data.presets.desktop).map(([id, p]) => [
          id,
          { name: p.name, baseUrl: p.baseUrl, models: p.models },
        ]),
      ),
      knownDrift: {
        defaultPrompt:
          '桌面端 DEFAULT_PROMPT 是 3 行短版，安卓端 ZJ_DEFAULT_PROMPT 是 389 字长版，两边有意不同，校验只要求各自与快照一致，不要求两者相等。',
        qwenModels:
          '各服务商的模型列表长度都不同（桌面 deepseek 2 个 vs 安卓 4 个、qwen 4 个 vs 65 个、moonshot 3 个 vs 5 个、zhipu 3 个 vs 8 个），安卓端是扩充后的列表；校验只警告，不失败。',
        localModels:
          '桌面端有 ollama/lmstudio 两个本机预设，安卓端没有（平板版固定云端，不含本机 Ollama）。',
      },
    };
    fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true });
    fs.writeFileSync(JSON_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    console.log('已刷新 shared/model-data.json（价目 '
      + Object.keys(snapshot.prices).length + ' 个模型，提示词常量 '
      + Object.keys(snapshot.promptConstants).length + ' 个，预设 '
      + Object.keys(snapshot.presets).length + ' 个）。');
    console.log('注意：--write 只刷新快照，不改代码；请确认两边代码的改动是你有意做的，再一起提交。');
    return;
  }

  if (!fs.existsSync(JSON_PATH)) {
    console.error('缺少 shared/model-data.json，先跑一次 node tools/sync-model-data.js --write 生成。');
    process.exit(1);
  }
  const snapshot = JSON.parse(read(JSON_PATH));

  // 1. 价目：三方一致
  const allModels = new Set([
    ...Object.keys(snapshot.prices),
    ...Object.keys(data.prices.desktop),
    ...Object.keys(data.prices.android),
  ]);
  for (const model of [...allModels].sort()) {
    const s = snapshot.prices[model];
    const d = data.prices.desktop[model];
    const a = data.prices.android[model];
    const fmt = (v) => (v ? v.in + '/' + v.out : '缺失');
    if (JSON.stringify(s) !== JSON.stringify(d) || JSON.stringify(s) !== JSON.stringify(a)) {
      errors.push(`价目不一致 ${model}：快照=${fmt(s)}，桌面=${fmt(d)}，安卓=${fmt(a)}`);
    }
  }

  // 2. 提示词常量：三方一致
  for (const name of PROMPT_CONSTANTS) {
    const s = snapshot.promptConstants[name];
    const d = data.promptConstants[name].desktop;
    const a = data.promptConstants[name].android;
    if (s !== d || s !== a) {
      errors.push(`提示词常量不一致 ${name}：快照${s === d ? '＝' : '≠'}桌面，桌面${d === a ? '＝' : '≠'}安卓`);
    }
    if (d === null || a === null) {
      errors.push(`提示词常量缺失 ${name}：桌面=${d === null ? '无' : '有'}，安卓=${a === null ? '无' : '有'}`);
    }
  }

  // 3. 默认提示词：各自与快照一致（两者之间不要求相等，有意不同）
  if (snapshot.defaultPrompts.desktop !== data.defaultPrompts.desktop) {
    errors.push('默认提示词不一致：桌面端 DEFAULT_PROMPT 与快照不同');
  }
  if (snapshot.defaultPrompts.android !== data.defaultPrompts.android) {
    errors.push('默认提示词不一致：安卓端 ZJ_DEFAULT_PROMPT 与快照不同');
  }

  // 4. 预设：共有 id 的 name/baseUrl 必须一致；模型列表只警告
  const androidOnly = Object.keys(data.presets.android).filter(
    (id) => !data.presets.desktop[id],
  );
  const desktopOnly = Object.keys(data.presets.desktop).filter(
    (id) => !data.presets.android[id],
  );
  if (androidOnly.length) warnings.push('安卓独有预设：' + androidOnly.join(', '));
  if (desktopOnly.length) warnings.push('桌面独有预设（预期内，本机模型）：' + desktopOnly.join(', '));
  for (const id of Object.keys(data.presets.desktop)) {
    if (!data.presets.android[id]) continue;
    const d = data.presets.desktop[id];
    const a = data.presets.android[id];
    const s = snapshot.presets[id];
    if (d.name !== a.name || d.baseUrl !== a.baseUrl) {
      errors.push(`预设不一致 ${id}：name/baseUrl 桌面(${d.name}/${d.baseUrl}) vs 安卓(${a.name}/${a.baseUrl})`);
    }
    if (s && (s.name !== d.name || s.baseUrl !== d.baseUrl)) {
      errors.push(`预设不一致 ${id}：快照与桌面代码不同`);
    }
    if (JSON.stringify([...d.models].sort()) !== JSON.stringify([...a.models].sort())) {
      warnings.push(`模型列表不同 ${id}：桌面 ${d.models.length} 个，安卓 ${a.models.length} 个（已知差异，只警告）`);
    }
  }

  for (const w of warnings) console.log('警告：' + w);
  if (errors.length) {
    for (const e of errors) console.error('错误：' + e);
    console.error(`同步校验失败：${errors.length} 项不一致。改法：两边代码一起改，再跑 node tools/sync-model-data.js --write 刷新快照。`);
    process.exit(1);
  }
  console.log(`同步校验通过：价目 ${Object.keys(snapshot.prices).length} 个模型、`
    + `提示词常量 ${PROMPT_CONSTANTS.length} 个、预设 ${Object.keys(data.presets.desktop).length} 个（桌面）/`
    + `${Object.keys(data.presets.android).length} 个（安卓）一致；警告 ${warnings.length} 条。`);
}

main();
