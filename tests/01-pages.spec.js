import { test, expect } from '@playwright/test';
import {
  allPages, indexablePages, NON_INDEXABLE,
  recordRequests, callHookWithFile, setLang, expectKeyTriggersFilePicker,
} from './helpers.js';

const pages = allPages();

test.describe('页面健康检查', () => {
  for (const p of pages) {
    test(`${p} 可加载、无控制台错误、无请求失败`, async ({ page }) => {
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];

      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));
      page.on('requestfailed', r => failedRequests.push(`${r.url()} — ${r.failure()?.errorText || ''}`));

      const res = await page.goto('/' + p, { waitUntil: 'load' });

      expect(res.status(), 'HTTP 状态码').toBe(200);
      await expect(page.locator('header.site-header .logo')).toBeVisible();
      await expect(page.locator('footer.site-footer')).toBeVisible();
      await expect(page.locator('#langBtn')).toBeVisible();
      await expect(page.locator('main')).toBeVisible();

      const title = (await page.title()).trim();
      expect(title.length, '页面标题不应为空').toBeGreaterThan(0);

      expect(pageErrors, '未捕获异常:\n' + pageErrors.join('\n')).toEqual([]);
      expect(consoleErrors, '控制台错误:\n' + consoleErrors.join('\n')).toEqual([]);
      expect(failedRequests, '请求失败:\n' + failedRequests.join('\n')).toEqual([]);
    });
  }
});

test.describe('部署边界', () => {
  // Cloudflare Pages 以仓库根目录作为发布目录，开发产物默认会被公开服务。
  // 线上实测过 /tests/fixtures/sample.pdf 以 application/pdf 正常返回。
  // _redirects 负责拦掉它们，这里从行为上验证拦截确实生效。
  const DEV_PATHS = [
    ['/package.json', /json/i],
    ['/package-lock.json', /json/i],
    ['/playwright.config.js', /javascript/i],
    ['/eslint.config.js', /javascript/i],
    ['/scripts/vendor.json', /json/i],
    ['/tests/helpers.js', /javascript/i],
    ['/tests/fixtures/sample.pdf', /pdf/i],
    ['/README.md', /markdown/i],
  ];

  for (const [devPath, forbiddenType] of DEV_PATHS) {
    test(`${devPath} 不得作为站点资源返回`, async ({ request }) => {
      const res = await request.get(devPath);
      const contentType = res.headers()['content-type'] || '';
      expect(
        forbiddenType.test(contentType),
        `${devPath} 竟然以 ${contentType} 返回了内容`
      ).toBe(false);
    });
  }

  test('站点自身资源仍应正常服务（避免拦截规则误伤）', async ({ request }) => {
    for (const [p, type] of [
      ['/index.html', /html/],
      ['/assets/style.css', /css/],
      ['/assets/app.js', /javascript/],
      ['/assets/vendor/jszip.min.js', /javascript/],
      ['/robots.txt', /plain/],
      ['/sitemap.xml', /xml/],
    ]) {
      const res = await request.get(p);
      expect(res.status(), `${p} 应可访问`).toBe(200);
      expect(res.headers()['content-type'] || '', `${p} 的 Content-Type 不符`).toMatch(type);
    }
  });

  test('响应头不得出现被逗号合并的同名指令', async ({ request }) => {
    // Cloudflare 对多条规则命中的同名响应头是「逗号合并」。曾经 _headers 里三条规则
    // 都设置 Cache-Control，导致指令串里出现两个互相冲突的 max-age。
    for (const p of ['/index.html', '/assets/app.js', '/assets/vendor/jszip.min.js']) {
      const res = await request.get(p);
      const cc = res.headers()['cache-control'] || '';
      const maxAgeCount = (cc.match(/max-age/g) || []).length;
      expect(maxAgeCount, `${p} 的 Cache-Control 出现了多个 max-age: ${cc}`).toBeLessThanOrEqual(1);
    }
  });

  test('安全响应头仍正常下发', async ({ request }) => {
    const res = await request.get('/index.html');
    const csp = res.headers()['content-security-policy'] || '';
    expect(csp).toContain("connect-src 'none'");
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['referrer-policy']).toBe('no-referrer');
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['cross-origin-opener-policy']).toBe('same-origin');
  });

  test('HSTS 已启用且取值合法', async ({ request }) => {
    // 没有 HSTS 时，首次请求仍是明文，可被 SSL-stripping 利用。
    // 注意 max-age 必须是单个值：若同时在本文件与 Cloudflare 控制台开启了 HSTS，
    // 响应头会被逗号合并成 "max-age=A, max-age=B"，属非法值浏览器会整条忽略。
    const res = await request.get('/index.html');
    const hsts = res.headers()['strict-transport-security'] || '';
    expect(hsts, '缺少 Strict-Transport-Security').not.toBe('');
    const ages = hsts.match(/max-age=/g) || [];
    expect(ages.length, `HSTS 出现多个 max-age（被逗号合并？）: ${hsts}`).toBe(1);
    const maxAge = Number((hsts.match(/max-age=(\d+)/) || [])[1]);
    expect(Number.isInteger(maxAge) && maxAge >= 86400, `max-age 过小或非法: ${hsts}`).toBe(true);
  });
});

test.describe('重依赖按需加载', () => {
  /* 首屏体积的直接约束：这些库只在用户真正用到时才该被下载。
   *
   * 断言落在「有没有发起请求」上，而不是「有没有 <script src> 标签」——
   * 后者可以用 defer、type=module 或动态注入绕过，前者才是用户实际付出的流量。
   * 这些库此前在解析 HTML 时就无条件下载，占相应页面首屏 gzip 体积的 80% 以上。 */
  const HEAVY = [
    ['/tools/pdf-to-docx.html', [
      '/assets/vendor/pdfjs/pdf.min.js',
      '/assets/vendor/pdfjs/pdf.worker.min.js',
      '/assets/vendor/docx.umd.js',
    ]],
    ['/tools/docx-to-pdf.html', [
      '/assets/vendor/jszip.min.js',
      '/assets/vendor/docx-preview.min.js',
      '/assets/vendor/jspdf.umd.min.js',
      '/assets/vendor/html2canvas.min.js',
    ]],
  ];

  for (const [pagePath, libs] of HEAVY) {
    test(`${pagePath} 首屏不下载重依赖`, async ({ page }) => {
      const rec = recordRequests(page);
      await page.goto(pagePath, { waitUntil: 'load' });
      // 留一点时间窗口，让任何延迟触发的加载暴露出来
      await page.waitForTimeout(400);

      for (const lib of libs) {
        const hit = rec.requests.find(r => r.url.endsWith(lib));
        expect(hit, `${lib} 不应在首屏被下载`).toBeUndefined();
      }
    });
  }

  test('PDF 转 Word：转换时才加载 pdf.js 与 docx', async ({ page }) => {
    const rec = recordRequests(page);
    await page.goto('/tools/pdf-to-docx.html', { waitUntil: 'load' });

    const before = rec.requests.length;
    await callHookWithFile(page, '__lkConvert', 'sample.pdf', 'application/pdf');

    const after = rec.requests.slice(before).map(r => r.url);
    expect(after.some(u => u.endsWith('/assets/vendor/pdfjs/pdf.min.js')), '应加载 pdf.js').toBe(true);
    expect(after.some(u => u.endsWith('/assets/vendor/docx.umd.js')), '应加载 docx').toBe(true);
  });

  test('DOCX 转 PDF：转换时才加载四个依赖', async ({ page }) => {
    const rec = recordRequests(page);
    await page.goto('/tools/docx-to-pdf.html', { waitUntil: 'load' });

    const before = rec.requests.length;
    await callHookWithFile(page, '__lkProcess', 'sample.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    const after = rec.requests.slice(before).map(r => r.url);
    for (const lib of ['jszip.min.js', 'docx-preview.min.js', 'jspdf.umd.min.js', 'html2canvas.min.js']) {
      expect(after.some(u => u.endsWith('/assets/vendor/' + lib)), `应加载 ${lib}`).toBe(true);
    }
  });

  test('按需加载不会产生任何对外请求（隐私承诺不受影响）', async ({ page }) => {
    const rec = recordRequests(page);
    await page.goto('/tools/docx-to-pdf.html', { waitUntil: 'load' });
    await callHookWithFile(page, '__lkProcess', 'sample.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(rec.external().map(r => r.url)).toEqual([]);
  });
});

test.describe('键盘可达性', () => {
  /* 拖拽区原本只是一个带 click 监听的 <div>，而真正的 <input type="file"> 带着
   * hidden 属性——纯键盘用户没有任何办法触发文件选择。修复放在 LK.setupDropzone 里，
   * 一处覆盖全部工具页，这里从行为上验证它确实生效。 */
  const SAMPLE = ['/tools/compress-image.html', '/tools/merge-pdf.html'];

  for (const p of SAMPLE) {
    test(`${p} 拖拽区具备按钮语义且可被 Tab 聚焦`, async ({ page }) => {
      await page.goto(p);
      const zone = page.locator('#dropzone');
      await expect(zone).toHaveAttribute('role', 'button');
      await expect(zone).toHaveAttribute('tabindex', '0');
      await expect(zone).toHaveAttribute('aria-label', /\S/);
    });
  }

  /* 这两条曾经用 page.waitForEvent('filechooser') 断言，而且失败是偶发的：
   * Space 在 --repeat-each=20 下挂了 5 次（Enter 20/20 通过，同一条代码路径）。
   * 失败时原生对话框已经打开，会把渲染进程和 worker 一起卡死——一次 90 秒超时拖成整份套件
   * 一小时不返回。断言对象因此改为「真实文件输入框的 click 事件」，理由详见 helpers.js。
   * 产品侧的契约没有变：Enter 与 Space 都必须把 click 打到那个隐藏 input 上。 */
  test('按 Enter 会驱动文件输入框', async ({ page }) => {
    await expectKeyTriggersFilePicker(page, 'Enter');
  });

  test('按 Space 同样会驱动文件输入框', async ({ page }) => {
    await expectKeyTriggersFilePicker(page, 'Space');
  });

  test('aria-label 跟随语言切换（不能只留静态英文兜底）', async ({ page }) => {
    await setLang(page, 'zh');
    await page.goto('/tools/compress-image.html');
    const label = await page.locator('#dropzone').getAttribute('aria-label');
    expect(label, '中文界面下 aria-label 应已被翻译').toMatch(/[\u4e00-\u9fa5]/);
  });
});

test.describe('首页搜索与分类筛选', () => {
  /* 断言一律用 :visible 而不是查 hidden 属性——「属性设对了但 CSS 覆盖掉」
   * 正是这个功能最容易出的问题（.tool-card 是 display:flex，会盖住 [hidden]）。 */

  test('默认展示全部 20 个工具，且状态行为空', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.tool-card:visible')).toHaveCount(20);
    await expect(page.locator('#filterStatus')).toHaveText('');
  });

  test('关键词命中唯一工具时只剩一张卡片', async ({ page }) => {
    await page.goto('/index.html');
    await page.fill('#toolSearch', 'watermark');
    await expect(page.locator('.tool-card:visible')).toHaveCount(1);
    await expect(page.locator('.tool-card:visible')).toHaveAttribute('href', 'tools/image-watermark.html');
  });

  test('多词按「全部命中」处理（缩小范围而不是放大）', async ({ page }) => {
    await page.goto('/index.html');
    await page.fill('#toolSearch', 'pdf');
    const pdfOnly = await page.locator('.tool-card:visible').count();
    await page.fill('#toolSearch', 'pdf merge');
    const both = await page.locator('.tool-card:visible').count();

    expect(both).toBeGreaterThan(0);
    expect(both, '多一个词应当收窄结果').toBeLessThan(pdfOnly);
  });

  test('中文界面下输入英文术语也能命中（用户习惯用英文词搜索）', async ({ page }) => {
    // 这条盯的是 LKI.tIn('en', …) 那一路：中文界面的可见文案里没有 "watermark"，
    // 只有把英文原文一并纳入匹配范围才命中。
    await setLang(page, 'zh');
    await page.goto('/index.html');
    await expect(page.locator('h1')).toContainText('免费');

    await page.fill('#toolSearch', 'watermark');
    await expect(page.locator('.tool-card:visible')).toHaveCount(1);
  });

  test('分类筛选只留下该分类的卡片，且其余分类整段隐藏', async ({ page }) => {
    await page.goto('/index.html');
    await page.click('#catFilter .chip[data-cat="docs"]');

    const visible = await page.locator('.tool-card:visible').count();
    const inDocs = await page.locator('section[data-cat="docs"] .tool-card:visible').count();
    expect(visible).toBeGreaterThan(0);
    expect(visible, '可见卡片必须全部来自 docs 分类').toBe(inDocs);

    for (const cat of ['image', 'text', 'dev']) {
      await expect(page.locator(`section[data-cat="${cat}"]`), `${cat} 分区应整段隐藏`).toBeHidden();
    }
  });

  test('搜索与分类可以叠加', async ({ page }) => {
    await setLang(page, 'en');   // 断言的是英文提示文案，必须显式指定语言
    await page.goto('/index.html');
    await page.click('#catFilter .chip[data-cat="docs"]');
    await page.fill('#toolSearch', 'watermark');   // watermark 属于 image 分类
    await expect(page.locator('.tool-card:visible')).toHaveCount(0);
    await expect(page.locator('#filterStatus')).toContainText('No tool matches');
  });

  test('无结果时给出提示，且不残留任何卡片', async ({ page }) => {
    await page.goto('/index.html');
    await page.fill('#toolSearch', 'zzzznope');
    await expect(page.locator('.tool-card:visible')).toHaveCount(0);
    await expect(page.locator('#filterStatus')).toContainText('No tool matches');
  });

  test('命中计数与实际可见数量一致', async ({ page }) => {
    await setLang(page, 'en');   // 计数文案的格式因语言而异，显式指定避免依赖运行环境的默认 locale
    await page.goto('/index.html');
    await page.fill('#toolSearch', 'pdf');
    const n = await page.locator('.tool-card:visible').count();
    // 计数文案与实际可见数必须对上——两者由同一处逻辑产出，写错就会互相矛盾
    await expect(page.locator('#filterStatus')).toHaveText(`${n} of 20 tools`);
  });

  test('筛选生效时收起补充内容，清空后原样恢复', async ({ page }) => {
    await page.goto('/index.html');
    const extra = page.locator('main .block:not([data-cat])');
    expect(await extra.count(), '首页应有非工具分区（Why / FAQ）').toBeGreaterThan(0);
    await expect(extra.first()).toBeVisible();

    await page.fill('#toolSearch', 'pdf');
    for (let i = 0; i < await extra.count(); i++) {
      await expect(extra.nth(i), '筛选时补充内容应收起').toBeHidden();
    }

    await page.fill('#toolSearch', '');
    await expect(page.locator('.tool-card:visible')).toHaveCount(20);
    await expect(extra.first(), '清空后应恢复').toBeVisible();
    await expect(page.locator('#filterStatus')).toHaveText('');
  });

  test('按 / 聚焦搜索框，Esc 清空并取消聚焦', async ({ page }) => {
    await page.goto('/index.html');
    await page.locator('body').click();
    await page.keyboard.press('/');
    await expect(page.locator('#toolSearch')).toBeFocused();

    await page.fill('#toolSearch', 'pdf');
    await expect(page.locator('.tool-card:visible')).not.toHaveCount(20);

    await page.keyboard.press('Escape');
    await expect(page.locator('#toolSearch')).toHaveValue('');
    await expect(page.locator('.tool-card:visible')).toHaveCount(20);
    await expect(page.locator('#toolSearch')).not.toBeFocused();
  });

  test('分类按钮的选中态跟着点击走，且始终只有一个', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#catFilter .chip.on')).toHaveCount(1);
    await page.click('#catFilter .chip[data-cat="text"]');
    await expect(page.locator('#catFilter .chip.on')).toHaveCount(1);
    await expect(page.locator('#catFilter .chip[data-cat="text"]')).toHaveClass(/\bon\b/);
  });
});

test.describe('站点结构完整性', () => {
  test('首页列出了全部 20 个工具卡片', async ({ page }) => {
    await page.goto('/index.html');
    const hrefs = await page.$$eval('.tool-card', els => els.map(e => e.getAttribute('href')));
    const toolHrefs = hrefs.filter(h => h && h.startsWith('tools/')).sort();
    const expected = allPages().filter(p => p.startsWith('tools/')).sort();

    expect(toolHrefs.length, '卡片数量').toBe(20);
    expect(toolHrefs).toEqual(expected);
  });

  test('sitemap.xml 收录了全部可索引页面、URL 唯一、且不含错误页', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

    expect(locs.length).toBe(indexablePages().length);
    expect(new Set(locs).size, 'URL 不应重复').toBe(locs.length);

    // sitemap 必须收录「最终地址」：Cloudflare Pages 会把 .html 308 跳到无扩展名形式，
    // 收录 .html 等于让爬虫每次都多走一次跳转。
    expect(locs.some(l => /\.html$/.test(l)), 'sitemap 不应出现带 .html 的地址').toBe(false);

    for (const p of indexablePages()) {
      const suffix = p === 'index.html' ? '/' : '/' + p.replace(/\.html$/, '');
      expect(locs.some(l => l.endsWith(suffix)), `sitemap 缺少 ${p}`).toBeTruthy();
    }

    for (const p of NON_INDEXABLE) {
      expect(locs.some(l => l.endsWith('/' + p)), `sitemap 不应收录错误页 ${p}`).toBe(false);
    }
  });

  test('404 页面带 noindex 且不使用 canonical', async ({ page }) => {
    await page.goto('/404.html');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(await page.locator('link[rel="canonical"]').count(), '错误页不应设置 canonical').toBe(0);
  });

  test('robots.txt 指向 sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('Sitemap:');
  });

  test('每个工具页都有唯一的 canonical 与 JSON-LD', async ({ page }) => {
    const ORIGIN = 'https://youngray.asia';
    for (const p of allPages().filter(x => x.startsWith('tools/'))) {
      await page.goto('/' + p);
      const canonical = await page.getAttribute('link[rel=canonical]', 'href');

      // canonical 必须写「最终地址」——Cloudflare Pages 会把 .html 308 跳到无扩展名形式，
      // 所以带 .html 的 canonical 等于指向一个会跳转的中间地址。
      const pretty = p.replace(/\.html$/, '');
      expect(canonical, `${p} 缺少 canonical`).toBe(`${ORIGIN}/${pretty}`);

      const blocks = await page.$$eval('script[type="application/ld+json"]', els => els.map(e => e.textContent));
      expect(blocks.length, `${p} 应有 JSON-LD`).toBeGreaterThan(0);
      for (const b of blocks) expect(() => JSON.parse(b), `${p} 的 JSON-LD 应为合法 JSON`).not.toThrow();
    }
  });

  test('每页都有 og:url，且与本页地址一致（曾漏 23 个页面）', async ({ page }) => {
    /* 这条曾经是个真实的漏洞：check-syntax 对缺失的载体直接跳过，
     * 于是「23/24 个页面根本没有 og:url」在 CI 里完全看不见，
     * 而 README 写着三处地址载体都必须写。这里从渲染后的 DOM 上再断言一次。 */
    const ORIGIN = 'https://youngray.asia';
    for (const p of indexablePages()) {
      await page.goto('/' + p);
      const ogUrl = await page.getAttribute('meta[property="og:url"]', 'content');
      expect(ogUrl, `${p} 缺少 og:url`).toBeTruthy();

      const expected = p === 'index.html' ? ORIGIN + '/' : ORIGIN + '/' + p.replace(/\.html$/, '');
      expect(ogUrl, `${p} 的 og:url 与本页地址不一致`).toBe(expected);
    }
  });

  test('每页的 og:image 与 apple-touch-icon 都能实际取到', async ({ page, request }) => {
    // 静态检查只能证明文件在仓库里；这里证明它在服务端也能被取到——
    // 分享预览图 404 不会有任何运行时报错，只有真的去分享一次才看得见。
    for (const p of indexablePages()) {
      await page.goto('/' + p);

      const og = await page.getAttribute('meta[property="og:image"]', 'content');
      expect(og, `${p} 缺少 og:image`).toBeTruthy();
      expect(/^https:\/\//.test(og), `${p} 的 og:image 必须是绝对地址（社交抓取器不解析相对路径）`).toBe(true);
      const ogRes = await request.get(new URL(og).pathname);
      expect(ogRes.status(), `${p} 的 og:image 取不到: ${og}`).toBe(200);
      expect(ogRes.headers()['content-type'], `${p} 的 og:image 类型不对`).toMatch(/image\//);

      const icon = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
      expect(icon, `${p} 缺少 apple-touch-icon`).toBeTruthy();
      const iconPath = '/' + icon.replace(/^\.\.\//, '');
      expect((await request.get(iconPath)).status(), `${p} 的 apple-touch-icon 取不到: ${iconPath}`).toBe(200);

      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    }
  });

  test('错误页只带图标类元数据，不带 og:url / og:image', async ({ page }) => {
    // 404 不该被分享或推广：它没有 canonical（检查会拦），也不该有分享预览图
    await page.goto('/404.html');
    expect(await page.locator('meta[property="og:url"]').count()).toBe(0);
    expect(await page.locator('meta[property="og:image"]').count()).toBe(0);
    expect(await page.locator('link[rel="apple-touch-icon"]').count()).toBe(1);
    expect(await page.locator('meta[name="theme-color"]').count()).toBe(2);
  });
});
