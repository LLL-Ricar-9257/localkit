#!/usr/bin/env node
/**
 * 生成 sitemap.xml。
 *
 *   node scripts/gen-sitemap.mjs            重新生成
 *   node scripts/gen-sitemap.mjs --check    只校验现有文件是否与生成结果一致
 *
 * 存在的理由：`<lastmod>` 是 Google 明确会用的信号，但它**必须随页面改动而更新**。
 * 手工维护的日期一定会漂移——要么忘了改，要么全站写成同一天（等于没写）。
 *
 * 顺带修掉一个装反的地方：原先每个 URL 都带 changefreq 与 priority，而这两项
 * Google 已明确忽略；真正有用的 lastmod 反而没有。现在对调过来。
 *
 * ## 日期从哪来（为什么不用 git log）
 *
 * 直觉上 `git log -1 --format=%cs -- <file>` 是最自然的来源，但它在
 * tests/node/checks.test.mjs 里活不下来：那里把仓库复制到临时目录后只做
 * `git init && git add -A`（没有提交），git 历史为空，日期会退回文件 mtime
 * ——而副本的 mtime 是复制那一刻，于是「干净副本必须通过」这条基线必然失败。
 *
 * 因此改用内容哈希 + 提交进仓库的日期清单 scripts/sitemap-lastmod.json：
 *   - 页面内容哈希与清单一致 → 沿用清单里的日期（页面没变，日期不该变）
 *   - 页面内容哈希变了       → 取当天日期并回写清单（页面真的改了）
 * 这套规则不依赖 git、结果确定，因此可以在 CI 与自测里被校验。
 *
 * ## 顺序规则
 *
 * 刻意不写死页面清单，避免新增页面时要改两个地方：
 *   1. 首页
 *   2. tools/ 下页面，按 index.html 里卡片的出现顺序（即站点呈现给用户的顺序）
 *   3. 其余可收录页面，按路径字母序
 * 完整性由 scripts/check-syntax.mjs 兜底：漏收页面会直接报错。
 *
 * 退出码：0 = 一致/已生成，1 = --check 模式下不一致
 * 环境变量：LK_ROOT 指定仓库根目录（供自测使用，默认取脚本上一级）
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.env.LK_ROOT
  ? path.resolve(process.env.LK_ROOT)
  : path.resolve(import.meta.dirname, '..');

const ORIGIN = 'https://youngray.asia';
const ERROR_PAGE = '404.html';
const MANIFEST_REL = 'scripts/sitemap-lastmod.json';
const checkOnly = process.argv.includes('--check');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'test-results', 'playwright-report', 'blob-report']);

/** 收集所有 HTML 页面（相对仓库根、正斜杠）。 */
function collectPages(dir = ROOT, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectPages(p, acc);
    else if (e.name.endsWith('.html')) acc.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
  return acc;
}

const pages = collectPages().filter(p => p !== ERROR_PAGE);

/** 首页卡片的出现顺序，即工具页的推荐顺序。 */
function toolOrderFromIndex() {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = [];
  for (const m of src.matchAll(/href="(tools\/[^"#?]+\.html)"/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

const toolOrder = toolOrderFromIndex();
const toolPages = pages.filter(p => p.startsWith('tools/'));
const otherPages = pages.filter(p => !p.startsWith('tools/'));

const ordered = [
  'index.html',
  // 先按首页卡片顺序，再补上首页没列到的（漏列会被 check-syntax 报错）
  ...[...toolOrder.filter(p => toolPages.includes(p)),
      ...toolPages.filter(p => !toolOrder.includes(p)).sort()],
  ...otherPages.filter(p => p !== 'index.html').sort(),
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

const manifestPath = path.join(ROOT, MANIFEST_REL);
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : {};

/** 页面的最后修改日期：内容没变就沿用清单，内容变了就取当天。 */
function resolveLastmod(rel) {
  const hash = sha256(fs.readFileSync(path.join(ROOT, rel)));
  const prev = manifest[rel];
  if (prev && prev.hash === hash && /^\d{4}-\d{2}-\d{2}$/.test(prev.lastmod)) {
    return { lastmod: prev.lastmod, hash, changed: false };
  }
  return { lastmod: today(), hash, changed: true };
}

const resolved = ordered.map(rel => [rel, resolveLastmod(rel)]);
const changed = resolved.filter(([, r]) => r.changed).map(([rel]) => rel);

/** 页面自身的最终地址（无扩展名；index 归一到根）。 */
function ownUrl(rel) {
  return rel === 'index.html' ? ORIGIN + '/' : ORIGIN + '/' + rel.replace(/\.html$/, '');
}

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  resolved.map(([rel, r]) =>
    `  <url><loc>${ownUrl(rel)}</loc><lastmod>${r.lastmod}</lastmod></url>`
  ).join('\n') +
  '\n</urlset>\n';

/* 清单里只持久化 lastmod 与内容哈希。
 * changed 是本次运行的瞬态判断，绝不能写进去——否则第二次运行它会由 true 变 false，
 * 清单内容随之改变，--check 立刻报「不一致」。（这个自相矛盾被第一次 --check 抓到了。） */
const newManifest = {};
for (const [rel, r] of resolved) newManifest[rel] = { lastmod: r.lastmod, hash: r.hash };
const manifestJson = JSON.stringify(newManifest, null, 2) + '\n';

const sitemapPath = path.join(ROOT, 'sitemap.xml');
const normalize = (s) => s.replace(/\r\n/g, '\n');

if (checkOnly) {
  const problems = [];

  if (!fs.existsSync(sitemapPath)) {
    problems.push('sitemap.xml 不存在');
  } else if (normalize(fs.readFileSync(sitemapPath, 'utf8')) !== xml) {
    const a = normalize(fs.readFileSync(sitemapPath, 'utf8')).split('\n');
    const b = xml.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        problems.push(`第 ${i + 1} 行\n      现有 ${a[i] ?? '(缺)'}\n      应为 ${b[i] ?? '(多余)'}`);
      }
    }
  }

  if (fs.existsSync(manifestPath) && normalize(fs.readFileSync(manifestPath, 'utf8')) !== manifestJson) {
    problems.push('scripts/sitemap-lastmod.json 与页面内容不一致（有页面改过但未重新生成）');
  }

  if (problems.length) {
    console.log(`✗ sitemap 与生成结果不一致（${problems.length} 处）：`);
    console.log(problems.slice(0, 10).map(p => '  · ' + p).join('\n'));
    if (problems.length > 10) console.log(`  …另有 ${problems.length - 10} 处`);
    console.log('\n  修复：node scripts/gen-sitemap.mjs');
    process.exit(1);
  }

  console.log(`sitemap.xml 与生成结果一致（${ordered.length} 条 URL，lastmod 均为最新）。`);
  process.exit(0);
}

// 保持文件原有行尾风格，避免制造整文件 diff
function writeKeepingEol(file, content) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.writeFileSync(file, existing.includes('\r\n') ? content.replace(/\n/g, '\r\n') : content, 'utf8');
}

writeKeepingEol(sitemapPath, xml);
writeKeepingEol(manifestPath, manifestJson);

console.log(`已生成 sitemap.xml：${ordered.length} 条 URL（含 lastmod，已移除 changefreq / priority）。`);
if (changed.length) {
  console.log(`本次更新日期的页面 ${changed.length} 个：`);
  changed.forEach(r => console.log('  · ' + r));
} else {
  console.log('所有页面内容未变，日期沿用清单。');
}
