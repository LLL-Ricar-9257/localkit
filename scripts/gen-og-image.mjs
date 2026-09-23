#!/usr/bin/env node
/**
 * 生成社交分享预览图与主屏图标。
 *
 *   node scripts/gen-og-image.mjs
 *
 * 产出：
 *   assets/og-image.jpg          1200×630，og:image / twitter:image 用
 *   assets/apple-touch-icon.png  180×180，iOS「添加到主屏」用
 *
 * ## 为什么 og:image 是 JPEG 而不是 PNG
 *
 * 这张图的主体是平滑渐变，而渐变恰好是 PNG 最不擅长压缩的内容——实测同内容
 * PNG 308 KB、JPEG(q92) 约 70 KB，肉眼无差别。社交平台只抓取不参与首屏，
 * 但没理由让爬虫白拉 240 KB。主屏图标则相反：需要透明外框与锐利边缘，用 PNG。
 *
 * ## 为什么用 Playwright 截图而不是画图库
 *
 * 站点的视觉语言（渐变、圆角、字重、配色变量）已经写在 assets/style.css 里，
 * 用 canvas / 图形库重画一遍等于维护第二份实现，改一次配色要同步两处。
 * 这里直接用 Chromium 渲染一段与站点同源的 HTML 再截图——渲染结果就是浏览器里的样子，
 * 且不需要新增任何依赖（Playwright 已经是 devDependency）。
 *
 * 输出的 PNG 是**提交进仓库**的构建产物（与 assets/vendor 同理），
 * 因此这个脚本只在需要更新图片时手动运行，不进入 CI。
 *
 * 用法：node scripts/gen-og-image.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = process.env.LK_ROOT
  ? path.resolve(process.env.LK_ROOT)
  : path.resolve(import.meta.dirname, '..');

const OUT_DIR = path.join(ROOT, 'assets');

/* 配色与 assets/style.css 的 :root 保持一致。刻意重复这几个值而不是去解析 CSS：
 * 预览图是静态产物，读 CSS 变量会让这个脚本在「改配色」时静默产出旧配色，
 * 不如让它显式写出来、改配色时被人看见。 */
const ACCENT = '#4f46e5';
const ACCENT_2 = '#7c3aed';
const SURFACE = '#ffffff';

/** 社交预览图：1200×630（Facebook / Twitter / Slack / 微信 通用的 1.91:1）。 */
function ogHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_2} 100%);
    color: #fff; position: relative; overflow: hidden;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 84px;
  }
  /* 右下角曾放一枚大号半透明字母呼应 logo，截图出来是一块读不出含义的方块，
   * 反而像渲染故障，因此去掉。留白比装饰更有把握。 */
  .brand { display: flex; align-items: center; gap: 18px; margin-bottom: 34px; }
  .mark {
    width: 74px; height: 74px; border-radius: 20px; background: ${SURFACE};
    color: ${ACCENT}; font-size: 44px; font-weight: 900;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 10px 30px rgba(0,0,0,.18);
  }
  .name { font-size: 52px; font-weight: 800; letter-spacing: -.02em; }
  h1 { font-size: 62px; font-weight: 800; line-height: 1.16; letter-spacing: -.025em; max-width: 940px; }
  h1 .dim { color: rgba(255,255,255,.80); font-weight: 600; }
  .sub { margin-top: 22px; font-size: 27px; color: rgba(255,255,255,.90); max-width: 900px; line-height: 1.45; }
  .foot {
    position: absolute; left: 84px; right: 84px; bottom: 56px;
    display: flex; align-items: center; justify-content: space-between;
    font-size: 24px; color: rgba(255,255,255,.92); font-weight: 600;
  }
  .chips { display: flex; gap: 12px; }
  .chip {
    background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.26);
    border-radius: 999px; padding: 9px 20px; font-size: 21px; font-weight: 600;
  }
  .url { font-size: 27px; font-weight: 800; letter-spacing: .01em; }
</style></head>
<body>
  <div class="brand">
    <div class="mark">L</div>
    <div class="name">LocalKit</div>
  </div>
  <h1>Free online tools that<br><span class="dim">never upload your files</span></h1>
  <p class="sub">Compress images, merge PDFs, convert formats, generate QR codes — right in your browser. No upload, no sign-up, no tracking.</p>
  <div class="foot">
    <div class="chips">
      <span class="chip">20 tools</span>
      <span class="chip">100% local</span>
      <span class="chip">Works offline</span>
    </div>
    <div class="url">youngray.asia</div>
  </div>
</body></html>`;
}

/** 主屏图标：180×180，iOS 不接受透明通道，因此底色必须画满。 */
function iconHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 180px; height: 180px; }
  body {
    background: linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_2} 100%);
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  }
  .mark { font-size: 108px; font-weight: 900; color: #fff; line-height: 1; margin-top: -8px; }
</style></head>
<body><div class="mark">L</div></body></html>`;
}

const TARGETS = [
  { file: 'og-image.jpg', html: ogHtml, width: 1200, height: 630, type: 'jpeg', quality: 92 },
  { file: 'apple-touch-icon.png', html: iconHtml, width: 180, height: 180, type: 'png' },
];

const browser = await chromium.launch();
try {
  for (const t of TARGETS) {
    const page = await browser.newPage({
      viewport: { width: t.width, height: t.height },
      deviceScaleFactor: 1,
    });
    await page.setContent(t.html(), { waitUntil: 'load' });
    const dest = path.join(OUT_DIR, t.file);
    const shot = { path: dest, type: t.type };
    if (t.quality) shot.quality = t.quality;
    await page.screenshot(shot);
    await page.close();
    const kb = (fs.statSync(dest).size / 1024).toFixed(0);
    console.log(`已生成 assets/${t.file}  ${t.width}×${t.height}  ${kb} KB`);
  }
} finally {
  await browser.close();
}

console.log('');
console.log('提示：这两个 PNG 是提交进仓库的产物。改了配色或文案后重新运行本脚本即可。');
console.log('      og:image 用的是绝对地址（社交平台不会解析相对路径），');
console.log('      换域名时记得同步各页面的 og:image / twitter:image。');
