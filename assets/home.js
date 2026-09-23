/* LocalKit 首页：工具搜索与分类筛选 —— 只有 index.html 加载这个文件。
 *
 * 为什么单独成文件而不是内联在 index.html 里：
 * 页面内联 <script> 不在 ESLint 的覆盖范围内（见 eslint.config.js 里那段说明），
 * 而 assets/*.js 在。这段逻辑有真实的复杂度，值得被 lint 保护。
 *
 * 匹配范围刻意包含三部分，理由各不相同：
 *   1. 当前语言的可见文案 —— 用户看到什么就能搜到什么；
 *   2. 英文原文（经 LKI.tIn('en', …)）—— 中文界面下输入 "compress" 也应命中「压缩图片」。
 *      用户输入的往往是他习惯的英文术语，而不是界面当前语言的词；
 *   3. 卡片的 href —— tools/merge-pdf 让 "pdf" 在中文界面下也能命中，
 *      不必依赖文案里恰好出现该词。
 */
(function () {
  'use strict';

  const input = document.getElementById('toolSearch');
  const chipBox = document.getElementById('catFilter');
  const status = document.getElementById('filterStatus');
  if (!input || !chipBox || !status) return;

  const LKI = window.LKI;

  /* 工具分区（含 .tool-card 的 .block）与首页上的补充内容分区。
   * 筛选生效时把补充内容一并收起——正在找工具的人最不需要「为什么不同」和 FAQ。 */
  const blocks = Array.from(document.querySelectorAll('main .block'));
  const toolBlocks = blocks.filter(function (b) { return b.querySelector('.tool-card'); });
  const extraBlocks = blocks.filter(function (b) { return !b.querySelector('.tool-card'); });

  const totalCards = toolBlocks.reduce(function (n, b) {
    return n + b.querySelectorAll('.tool-card').length;
  }, 0);

  let index = null;      // [{ card, block, hay }]，延迟构建
  let category = 'all';

  /** NFKC 把全角折成半角：中文输入法下打出的「ＰＤＦ」也能匹配「PDF」。 */
  function normalize(s) {
    return String(s).toLowerCase().normalize('NFKC');
  }

  function buildIndex() {
    const out = [];
    for (const block of toolBlocks) {
      for (const card of block.querySelectorAll('.tool-card')) {
        const parts = [card.textContent, card.getAttribute('href') || ''];
        for (const el of card.querySelectorAll('[data-i18n]')) {
          if (LKI) parts.push(LKI.tIn('en', el.getAttribute('data-i18n')));
        }
        out.push({ card: card, block: block, hay: normalize(parts.join(' ')) });
      }
    }
    return out;
  }

  function apply() {
    // 多词按「全部命中」处理：输入 "pdf merge" 应当缩小范围，而不是放大
    const tokens = normalize(input.value.trim()).split(/\s+/).filter(Boolean);
    const filtering = tokens.length > 0 || category !== 'all';

    if (!index) index = buildIndex();

    let shown = 0;
    const perBlock = new Map();

    for (const item of index) {
      const catOk = category === 'all' || item.block.dataset.cat === category;
      const textOk = tokens.every(function (tk) { return item.hay.indexOf(tk) !== -1; });
      const hit = catOk && textOk;

      item.card.hidden = !hit;
      if (hit) {
        shown++;
        perBlock.set(item.block, (perBlock.get(item.block) || 0) + 1);
      }
    }

    for (const block of toolBlocks) block.hidden = !perBlock.get(block);
    /* 只在筛选生效时收起补充内容。未筛选时一个元素都不隐藏——
     * 那些文案对 SEO 与「禁用 JS 也能读」这两件事都还有用。 */
    for (const block of extraBlocks) block.hidden = filtering;

    if (!filtering) {
      status.textContent = '';
    } else if (shown === 0) {
      status.textContent = LKI ? LKI.t('index.noresults') : '';
    } else {
      status.textContent = LKI ? LKI.t('index.count', { n: shown, total: totalCards }) : '';
    }
  }

  input.addEventListener('input', apply);

  chipBox.addEventListener('click', function (e) {
    const btn = e.target.closest('.chip');
    if (!btn || !btn.dataset.cat) return;
    category = btn.dataset.cat;
    const all = chipBox.querySelectorAll('.chip');
    for (let i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i] === btn);
    apply();
  });

  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    input.value = '';
    apply();
    input.blur();
  });

  /* 按 / 聚焦搜索框（GitHub、MDN 等站点的通行约定）。
   * 已经在输入控件里时不拦截，否则用户没法在别处输入斜杠。 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    input.focus();
    input.select();
  });

  /* 语言切换后必须重建索引：haystack 里含当前语言的可见文案。 */
  if (LKI) LKI.onApply.push(function () { index = null; apply(); });
})();
