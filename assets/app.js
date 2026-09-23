/* LocalKit shared helpers — loaded by every tool page
 * 约定：任何要拼进 innerHTML 的动态字符串（文件名、用户输入、外部数据）
 * 都必须先经过 LK.esc() 转义。不要在各工具页里自己重写转义逻辑。 */
(function () {
  'use strict';

  /**
   * 浏览器 canvas 的单边硬上限。
   *
   * 超过它的 canvas **不会抛错**，但 drawImage 会静默变成空操作：
   * 实测 16384 可用；16385 起 fillRect 不报任何错、而 getImageData 读回全透明。
   * 所以必须在这里兜住——否则工具会「成功地」交出一张全透明空白图，
   * 用户拿到的是坏文件却全程看不到任何报错。
   */
  const MAX_CANVAS_SIDE = 16384;

  /* 按需加载的本地脚本缓存：同一个 src 只会真正插入一次，
   * 后续调用复用同一个 Promise（并发调用也不会插入两个 <script>）。 */
  const scriptLoads = new Map();

  /* 已注册的拖拽区，用于在语言切换后刷新 aria-label。 */
  const dropzones = [];

  function refreshDropzoneLabels() {
    for (const zone of dropzones) {
      const label = zone.querySelector('.title');
      if (label) zone.setAttribute('aria-label', label.textContent.trim());
    }
  }

  window.LK = {
    el(id) { return document.getElementById(id); },

    /**
     * 按需加载一个本地脚本（相对当前页面），返回 Promise。
     *
     * 存在的理由是首屏体积：重依赖（pdf.js 105 KB gzip、docx 135 KB gzip、
     * jsPDF + html2canvas 158 KB gzip）对绝大多数只「看一眼这个工具长什么样」的
     * 访问者毫无用处，却在解析 HTML 时就无条件下载。改成首次真正需要时再注入。
     *
     * CSP 是 `script-src 'self' 'unsafe-inline'`，动态注入的同源脚本被允许，
     * 因此这条路径不需要放宽任何策略。路径必须是相对路径（本站零外发承诺）。
     */
    loadScript(src) {
      let p = scriptLoads.get(src);
      if (p) return p;
      p = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => {
          // 失败时把缓存清掉，否则一次网络抖动会让该页永久无法重试
          scriptLoads.delete(src);
          reject(new Error('脚本加载失败: ' + src));
        };
        document.head.appendChild(s);
      });
      scriptLoads.set(src, p);
      return p;
    },

    /** 转义为 HTML 文本。用于所有要拼进 innerHTML 的动态值。 */
    esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
      return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    },

    /**
     * Wire a dropzone element: click -> hidden file input, drag & drop, keyboard.
     * cb(files) receives a FileList-like array.
     *
     * 键盘可达性在这里补齐，而不是要求每个工具页自己写：拖拽区原本只是一个带
     * click 监听的 <div>，而真正的 <input type="file"> 带着 hidden 属性——
     * 于是纯键盘用户没有任何办法触发文件选择。role/tabindex/Enter/Space 一并就地设置，
     * 一处覆盖全部工具页，也避免各页写法漂移。
     */
    setupDropzone(zone, input, cb) {
      if (!zone.hasAttribute('tabindex')) zone.setAttribute('tabindex', '0');
      if (!zone.getAttribute('role')) zone.setAttribute('role', 'button');
      if (dropzones.indexOf(zone) === -1) dropzones.push(zone);
      refreshDropzoneLabels();

      zone.addEventListener('click', () => input.click());
      zone.addEventListener('keydown', (e) => {
        // Space 的 e.key 在现代浏览器里就是 ' '；'Spacebar' 是旧 Edge/IE 的写法
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();   // 阻止 Space 把页面往下滚
          input.click();
        }
      });
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault(); zone.classList.remove('drag');
        if (e.dataTransfer.files.length) cb(e.dataTransfer.files);
      });
      input.addEventListener('change', () => {
        if (input.files.length) cb(input.files);
        input.value = ''; // allow re-selecting the same file
      });
    },

    downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },

    setStatus(msg, kind) {
      const s = document.querySelector('.status');
      if (!s) return;
      s.textContent = msg || '';
      s.classList.remove('err', 'ok');
      if (kind) s.classList.add(kind);
    },

    /** Decode an image file to a bitmap, downscaling if maxDim is set. */
    async decodeImage(file, maxDim) {
      const bitmap = await createImageBitmap(file);
      const longest = Math.max(bitmap.width, bitmap.height);
      // 用户指定的 maxDim 与平台硬上限取更小者。调用方通常传 0 表示「不限制」，
      // 但平台上限不是可选项——不兜住就会静默产出空白图（见 MAX_CANVAS_SIDE 的说明）。
      const limit = Math.min(maxDim || Infinity, MAX_CANVAS_SIDE);
      const scale = limit < longest ? limit / longest : 1;
      return {
        bitmap,
        width: Math.max(1, Math.round(bitmap.width * scale)),
        height: Math.max(1, Math.round(bitmap.height * scale)),
        /** 是否因超出上限而被缩小——供界面提示，避免让用户以为尺寸没变。 */
        clamped: scale < 1,
      };
    },

    /** Canvas -> Blob promise. */
    canvasToBlob(canvas, type, quality) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality);
      });
    },

    /** Inject the sponsor button into the nav and footer on every page (except donate itself). */
    injectSponsor() {
      if (/donate\.html?$/.test(location.pathname)) return;
      const pre = location.pathname.indexOf('/tools/') !== -1 ? '../' : '';
      const nav = document.querySelector('.nav');
      if (nav && !document.getElementById('donateBtn')) {
        const a = document.createElement('a');
        a.id = 'donateBtn';
        a.className = 'donate-btn';
        a.href = pre + 'donate.html';
        a.setAttribute('data-i18n', 'nav.donate');
        a.textContent = '♥ Sponsor';
        const lang = document.getElementById('langBtn');
        if (lang) nav.insertBefore(a, lang); else nav.appendChild(a);
      }
      const links = document.querySelector('.site-footer .links');
      if (links && !links.querySelector('.donate-btn')) {
        const f = document.createElement('a');
        f.className = 'donate-btn';
        f.href = pre + 'donate.html';
        f.setAttribute('data-i18n', 'nav.donate');
        f.textContent = '♥ Sponsor';
        links.insertBefore(f, links.firstChild);
      }
    },
  };

  /* 语言切换后 aria-label 必须跟着变。
   * 拖拽区的 aria-label 取自 .title 的当前文本，而 setupDropzone 是在页面解析时
   * 调用的——那一刻 i18n 还没落地，读到的是静态英文兜底。注册到 onApply 之后，
   * 中文用户切到中文时读屏器念的也是中文。 */
  if (window.LKI) window.LKI.onApply.push(refreshDropzoneLabels);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      window.LK.injectSponsor();
      if (window.LKI) window.LKI.apply(window.LKI.lang); // label the just-injected button
    });
  } else {
    window.LK.injectSponsor();
    if (window.LKI) window.LKI.apply(window.LKI.lang);
  }
})();
