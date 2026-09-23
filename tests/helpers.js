/**
 * 测试公共工具。不是测试文件本身，不匹配 Playwright 的 testMatch。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures');

/**
 * 不应被搜索引擎收录的页面。
 * 404.html 由 Cloudflare Pages 在未找到路径时自动返回，必须带 noindex 且不进 sitemap。
 */
export const NON_INDEXABLE = ['404.html'];

/** 全站页面清单：站点页 + 错误页 + tools/ 下全部工具页。用于逐页健康检查。 */
export function allPages() {
  const site = ['index.html', 'about.html', 'privacy.html', 'donate.html', ...NON_INDEXABLE];
  const tools = fs.readdirSync(path.join(ROOT, 'tools'))
    .filter(f => f.endsWith('.html'))
    .sort()
    .map(f => 'tools/' + f);
  return [...site, ...tools];
}

/** 应当出现在 sitemap.xml 中的页面（即全站页面减去不可收录的那些）。 */
export function indexablePages() {
  return allPages().filter(p => !NON_INDEXABLE.includes(p));
}

/** 读取夹具并转成 base64，便于传进浏览器上下文。 */
export function readFixture(name) {
  const buf = fs.readFileSync(path.join(FIXTURES, name));
  return { base64: buf.toString('base64'), bytes: buf.length };
}

/**
 * 在页面里把夹具还原成 File 对象，再调用指定的 window.__lk* 测试钩子。
 * 返回钩子的原始返回值（经 Playwright 序列化）。
 */
export async function callHookWithFile(page, hook, fixture, mime) {
  const { base64 } = readFixture(fixture);
  return page.evaluate(async ({ b64, name, type, hookName }) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const files = [new File([arr], name, { type })];
    const fn = window[hookName];
    if (typeof fn !== 'function') throw new Error('缺少测试钩子 ' + hookName);
    return await fn(files);
  }, { b64: base64, name: fixture, type: mime, hookName: hook });
}

/**
 * 监听并记录页面发出的每一个请求。
 * 返回 { requests, external } —— external 为所有非本站来源的请求。
 */
export function recordRequests(page) {
  const requests = [];
  page.on('request', (req) => {
    requests.push({ url: req.url(), type: req.resourceType() });
  });
  return {
    requests,
    external() {
      const origin = new URL(page.url() || 'http://127.0.0.1/').origin;
      return requests.filter(r =>
        /^https?:/i.test(r.url) && !r.url.startsWith(origin)
      );
    },
  };
}

/**
 * 在后续所有导航中预置语言偏好。
 * 语言选择存在 localStorage，同一个 page 上连续访问多个页面会互相污染，
 * 因此需要显式指定而不是靠点击按钮来回切。
 */
export async function setLang(page, lang) {
  await page.addInitScript((l) => {
    try { localStorage.setItem('lk-lang', l); } catch (e) { /* 隐私模式下可能不可用 */ }
  }, lang);
}

/**
 * 断言在拖拽区上按下某个键会驱动文件输入框。
 *
 * 为什么不用 page.waitForEvent('filechooser')：
 * 那要求 Playwright 与浏览器原生对话框的拦截时序刚好对上，实测是一次真实的偶发——
 * `--repeat-each=20` 下 Space 有 5 次拿不到事件，而 Enter 20 次全过，两者走的是同一条代码路径。
 * 更糟的是失败代价：事件没拿到时原生对话框已经在浏览器里打开了，它会卡住渲染进程，
 * worker 停止后 5 分钟仍无法退出（实测），于是整份套件被一条用例拖死。
 *
 * 所以这里把断言换到**真实 <input type="file"> 的 click 事件**上：
 * keydown → 处理器 → input.click() → click 事件，整条链路都还在，
 * 只把「操作系统对话框」这一步用 preventDefault 挡在门外。断言因此是确定的，
 * 且不再依赖任何操作系统层面的行为。
 *
 * 同时保留一个 filechooser 兜底监听：万一某个平台上 preventDefault 不足以拦住对话框，
 * 也让 Playwright 把它吞掉，不至于弹出原生模态卡死浏览器。
 */
export async function expectKeyTriggersFilePicker(page, key) {
  let dialogsRequested = 0;
  page.on('filechooser', () => { dialogsRequested++; });

  await page.goto('/tools/compress-image.html');
  await page.evaluate(() => {
    window.__fileInputClicks = 0;
    document.getElementById('fileInput').addEventListener('click', (e) => {
      e.preventDefault();   // 阻止弹出原生对话框，但不影响本次断言要观测的 click 事件
      window.__fileInputClicks++;
    });
  });

  const zone = page.locator('#dropzone');
  await zone.focus();
  await page.keyboard.press(key);

  await expect.poll(() => page.evaluate(() => window.__fileInputClicks),
    { message: `按 ${key} 应把 click 打到隐藏的文件输入框上` }).toBe(1);
  expect(dialogsRequested, 'preventDefault 应已拦下原生对话框').toBe(0);
}

/**
 * 取页面上真正可见的文本。
 *
 * 必须先把所有 <details> 展开：innerText 会跳过折叠元素的内容，
 * 而本站的 FAQ 答案是写在 <details> 里的，直接读 innerText 会漏掉整段文案。
 * 不用 textContent 是因为它会把 <script> 的源码也算进去。
 */
export async function visibleText(page) {
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => { d.open = true; });
  });
  return page.evaluate(() => document.body.innerText);
}

/**
 * 等待结果区出现预期数量的条目。
 *
 * 注意：不能用 page.waitForFunction —— 站点下发的 CSP 不含 'unsafe-eval'，
 * 而 waitForFunction 的轮询实现依赖 eval，会直接抛 CSP 错误。
 * 基于 locator 的断言由 Playwright 在页面外驱动，不受页面 CSP 约束，
 * 因此这里统一用它。为了测试方便去放开 'unsafe-eval' 是本末倒置。
 */
export async function expectCount(locator, n, message) {
  await expect(locator, message).toHaveCount(n);
}
