# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
早期提交没有打 tag，此处按日期追溯记录。

## [未发布]

### 社交分享：24 个页面此前只有 1 个能正常生成预览

起因是给分享功能做体检，结果发现的问题比预期严重得多。

#### 一个被检查静默放过的漏洞

README 的表格明确写着 `canonical` / `og:url` / JSON-LD `url` 三处地址载体「都必须写，且必须一致」，
`check:syntax` 也报「页面自身地址核对 46 处」。但实测：

| 载体 | 实际存在数量 |
|---|---|
| `canonical` | 24 |
| **`og:url`** | **1**（只有首页） |
| JSON-LD `url` | 21 |

46 = 24 + 1 + 21。**23 个页面根本没有 `og:url`，而检查从未报警。**

原因是那一行 `if (!val) continue;`——检查对「缺失的载体」直接跳过。
所以它校验的只是「存在的那几处是否自洽」，而不是「该有的都有」。
**检查对缺失沉默，等于把一致性交给运气**：文档承诺三处齐全，实现只有一处，而 CI 全绿。

#### 改动

- 补齐 24 个页面的 `og:url`，写各自的最终地址（无扩展名）。
- 新增 `og:image` / `og:image:width` / `og:image:height` / `twitter:card`，指向同一张 1200×630 的分享图。
- 新增 `theme-color`（区分明暗两套，与站点配色一致）与 `apple-touch-icon`，全站 24 页下发。
- `about.html` / `privacy.html` / `donate.html` 此前**连 `og:type` 都没有**——这 3 个页面完全没有
  Open Graph 标记。已按各自 `<title>` 与 `meta description` 补齐（不编造文案）。
- `404.html` 刻意只加 `theme-color` 与 `apple-touch-icon`：错误页不该被分享或推广。

#### 图片怎么来的

新增 `scripts/gen-og-image.mjs`（`npm run gen:og-image`）：用 Playwright 渲染一段与站点同源的 HTML
再截图。这样配色与站点一致，且**不需要引入任何图形库**——站点已经依赖 Playwright。

- `assets/og-image.jpg` 1200×630。第一版用 PNG 输出，308 KB；同样是平滑渐变，
  换成 JPEG(q92) 后 77 KB，肉眼无差别。社交平台只抓取不参与首屏，但没理由让爬虫白拉 240 KB。
- `assets/apple-touch-icon.png` 180×180。
- 第一版在右下角放了一枚大号半透明字母呼应 logo，截图出来是一块读不出含义的方块、像渲染故障，
  已去掉。**这是「生成完必须亲眼看一眼」的又一个例子。**

#### 补回检查

- `check:syntax`：`canonical` 与 `og:url` 改为**必填**，缺失即报错（JSON-LD 的 `url` 仍可选）。
  地址载体核对从 46 处变成 69 处，并新增「社交预览图核对 24 处」。
- `check:syntax`：新增 `og:image` 校验——必须存在、必须是绝对地址（社交抓取器不解析相对路径）、
  指向的文件必须真实存在。预览图 404 不会有任何运行时报错，属于最难自查的一类问题。
- 端到端新增 3 条：从渲染后的 DOM 上再断言一次 `og:url` 与 `canonical` 一致、
  真的去请求 `og:image` 与 `apple-touch-icon` 并断言 200、以及错误页不带 `og:*`。
- 校验脚本自测新增 4 条（缺 `og:url`、`og:image` 文件不存在、`og:image` 用相对地址、缺 `twitter:card`）。
  自测 32 → **36 条**，端到端 130 → **133 条**。

### 英文 README

仓库面向国际流量，而 README 一直是中文。新增 `README.en.md`，并在两份文档顶部互链。
英文版不是逐字翻译：保留了部署部分那些踩坑记录（它们才是真正有价值的内容），
压缩了中文版的叙事细节。`CONTRIBUTING.md` 暂未翻译，英文 README 里已注明。

### 仓库生态

- **`.nvmrc`**（`22`）：CI 矩阵里写死了 `'22','24'`，本地却没有版本提示。
  配合既有的 `.npmrc` `engine-strict=true`，版本不符会在 `npm install` 阶段明确失败。
- **`.github/dependabot.yml`**：npm（每周）与 GitHub Actions（每月）更新。
  开发依赖合并成单个 PR——它们只服务于本地检查与 CI，逐个提 PR 只是噪音。
  配置里写清了 `assets/vendor/` 那 9 个库**不在** Dependabot 管辖范围：
  它们不是 npm 包，由 `scripts/update-vendor.mjs` 的 sha256 清单负责，需要手工升级。
  两套机制各管一段，不要混起来。
- **`.github/FUNDING.yml`**：Sponsor 按钮指向站点自己的赞助页，而不是绑定 GitHub Sponsors——
  赞助渠道统一在 `assets/config.js` 与 `donate.html` 里配置，否则渠道清单一分二，改一处忘一处是必然的。

### 生成器输出：根因优先

`gen-sitemap --check` 原先把「清单与页面内容不一致」和逐行差异混在一个列表里。
页面改动较多时（差异行超过展示上限），**真正的根因被截断隐藏**，只剩一堆「第 N 行应为…」，
排查时得先猜是哪来的。现在根因单独置顶，逐行差异作为后果列在其下并注明来源。

这个问题是被校验脚本自测抓到的：一条用例先归零副本状态再注入缺陷，
而归零前的状态里差异行过多，把根因挤出了展示窗口。

### 首屏体积：重依赖改为按需加载（两个最重的工具页各降约 82%）

起因是一次体检测量。两个重工具页在解析 HTML 时就无条件下载全部第三方库，
而这些库对「只想看一眼这个工具长什么样」的访问者毫无用处：

| 页面 | 改前首屏 (gzip) | 改后首屏 (gzip) |
|---|---|---|
| `tools/pdf-to-docx.html` | 289 KB | **52 KB** |
| `tools/docx-to-pdf.html` | 249 KB | **46 KB** |

数字由 `zlib.gzipSync` 逐文件实测后求和，范围是「HTML + i18n + app + style + 该页 `<script src>` 里的 vendor」。
代价要说清：`assets/app.js` 增加了按需加载与键盘支持，gzip 从 2.4 KB 涨到 3.9 KB，
因此**首页首屏从 44 KB 变成 46 KB**——首页因此变重了 2 KB，换取两个重工具页各降 80% 以上。

#### 一个需要先纠正的测量错误

上一轮盘点时我把 `pdf.worker.min.js`（1.1 MB）也算进了首屏，据此报出「2.3 MB / 585 KB」。
这是错的：页面里那行只是给 `GlobalWorkerOptions.workerSrc` 赋一个字符串，
**worker 是 `getDocument()` 时才被 pdf.js 拉取的**，从来不在首屏。真实基线是 289 KB。

教训与项目里既有那条一致——**先量再改**，而且量完要回头确认量的是不是同一个东西。
（本次复核时发现正文与代码注释里的「288／43」「247／42」与此表对不上，
已统一为实测值——同一组数字出现三个版本，本身就是没量准的症状。）

#### 改动

- 新增 `LK.loadScript(src)`：按需注入本地脚本，同一路径只插入一次，失败时清缓存以便重试。
  CSP 是 `script-src 'self' 'unsafe-inline'`，动态注入同源脚本被允许，**没有放宽任何策略**。
- `pdf-to-docx`：`pdf.min.js`（105 KB gzip）改为选到文件时才加载，`docx.umd.js`（135 KB gzip）
  改为点「转换」时才加载。加载点放在 `convert()` 内部而不是按钮处理器里，
  因为测试钩子 `__lkConvert` 会绕过 dropzone 直接调它——放错位置会漏掉一条路径。
- `docx-to-pdf`：四个依赖（jszip / docx-preview / jsPDF / html2canvas，合计 205 KB gzip）
  全部延后到 `convert()`。拖入文件时只做扩展名校验，不碰任何库。
  `docx-preview` 依赖全局 JSZip，因此 jszip 先加载，其余三个并行。

#### 补回因此丢失的静态覆盖

这些路径不再是 HTML 的 `src=` 属性，`check-syntax` 的第 3 项扫不到——
写错不会在本地或 CI 暴露，只会在用户点「转换」那一刻 404。因此新增第 7 项检查：
校验浏览器侧代码（HTML 内联脚本 + `assets/*.js`）里出现的 vendor 路径确实存在。

扫描范围刻意排除了 `tests/` 与配置文件：前者里的 `/assets/vendor/*.js` 是**断言用的期望 URL**，
后者里的 `'assets/vendor/**'` 是忽略 glob。第一版把三类一起扫，直接报了 12 个假错误——
现在这两条边界各有一个用例锁住。

#### 测试

- 4 条新用例断言「首屏不发起这些请求」。断言落在**网络请求**上而不是 `<script src>` 标签上：
  后者可以用 defer 或动态注入绕过，前者才是用户实际付出的流量。
- 另 2 条断言「转换时确实加载了」，以及「按需加载不产生任何对外请求」。
- 反向验证：把 eager 标签加回去后，首屏断言立刻变红。

### 键盘用户此前无法使用任何文件工具

拖拽区是一个带 `click` 监听的 `<div>`，而真正的 `<input type="file">` 带着 `hidden`——
**纯键盘用户没有任何办法触发文件选择**。全站 20 个工具页都是这个形态。

修复放在 `LK.setupDropzone()` 里而不是各页自己写：就地补 `role="button"`、`tabindex="0"`
与 Enter/Space 处理，一处覆盖全部工具页，也避免 20 份写法漂移。

`aria-label` 取自拖拽区标题的当前文本，但 `setupDropzone` 是在页面解析时调用的，
那一刻 i18n 还没落地——读到的是静态英文兜底。因此把标签刷新注册到 `LKI.onApply`，
中文用户切换语言后读屏器念的也是中文。

另补 `:focus-visible` 样式：此前全站没有任何 `:focus` 规则，键盘用户只能依赖浏览器默认焦点环，
在渐变按钮和浅色拖拽区上几乎看不出来。用 `:focus-visible` 而非 `:focus`，
鼠标点击不会留下多余轮廓。

测试 6 条：语义与可聚焦性、Enter 与 Space 各自把 click 打到隐藏的文件输入框上、
以及 aria-label 跟随语言切换。

#### 这两条用例原本不是这么写的

初版用 `page.waitForEvent('filechooser')` 断言「真的弹出了选择对话框」——听上去比看属性强，
实际是个不稳定的外部依赖。复核时用 `--repeat-each=20` 压出来：**Space 有 5 次拿不到事件，
Enter 20 次全过**，而两者走的是同一条代码路径。更糟的是失败的代价：

事件没拿到，说明原生对话框已经在浏览器里打开了；它会卡住渲染进程，
`worker-0 process did not exit within 300000ms after stop`——**一条用例把整份套件拖成一小时不返回**。
（第一次跑全量时就是这么被坑的，一度看起来像「测试挂死」。）

探针显示产品代码一直是好的：`keydown[' '] → click()called → input-click-event` 三步齐全。
问题只出在测试手段。因此断言对象改为**真实文件输入框的 click 事件**，
用 `preventDefault` 把操作系统对话框挡在门外（实测 30/30 均如此，且链路完整），
另外留一个 `filechooser` 兜底监听，万一某平台拦不住也不至于弹出模态卡死浏览器。

教训：**断言「真实浏览器行为」听起来更硬，但一旦它跨到操作系统边界，就变成了不可控依赖。**
现在这两条在失败时是干净地红，而不是把 CI 拖死。

### 二维码工具：输入失效时残留上一次的二维码

`#content` 的默认值是 `https://example.com`，所以页面一加载就渲染出一个成功的二维码。
用户把输入清空后 `render()` 抛错，但 catch 分支**只改状态文字**——

> 界面上仍留着旧二维码，两个导出按钮也仍然可点，
> 用户会下载到一个与他当前输入完全无关的二维码。

与 `text-diff` 曾修过的「超限时残留旧结果」是同一类缺陷：报错的同时，
界面仍在展示一个看起来有效的结果。

修复：catch 分支一并清空 `preview`、重置 `current`、禁用两个导出按钮。
测试 3 条，其中 2 条是回归用例——先确认默认值能渲染成功，再断言报错后产物被清掉；
另 1 条覆盖「切到 Wi-Fi 模式但缺 SSID」这条同样会残留的路径。

> 这个缺陷不是读代码读出来的，是**为了给这个工具补测试钩子而写断言时撞上的**。

### 补齐最后两个缺失的测试钩子

`tools/json-to-typescript.html` 与 `tools/qr-generator.html` 此前没有 `window.__lk*` 钩子
（其余 18 个都有），只能通过 UI 驱动。commit `9144ac7` 的提交信息写着
「test hooks for all 20 tools」，与事实不符——**现在把它补成事实**。

- `json-to-typescript`：新增 `__lkConvert`，接受 JSON 文本或已解析的值；解析失败照常抛出，
  因此错误路径也能被断言。新增 4 条逻辑层用例（数组同形元素去重、根接口顺序、
  非标识符键名加引号、非法 JSON 抛错），原有 2 条 UI 用例保留——两者互补而非互相替代。
- `qr-generator`：新增 `__lkRender`，返回模块数、payload、SVG 是否存在、两个导出按钮状态。
  `render()` 改为返回结构化结果（作为事件处理器使用时返回值被忽略，不影响原有行为）。
  新增 6 条用例，含 Wi-Fi payload 的规范拼装与保留字符转义（分号是 `WIFI:` 格式的分隔符，
  出现在密码里不转义会让整个 payload 解析错位）。

### sitemap：装上真正有用的字段，移除已被忽略的字段

原先 24 条 URL **全部**带 `changefreq` 与 `priority`，而这两项 Google 已明确忽略；
真正有用的 `<lastmod>` 反而一个都没有。现在对调过来。

`<lastmod>` 必须随页面改动而更新，手工维护必然漂移（要么忘了改，要么全站写成同一天，
等于没写）。因此新增 `scripts/gen-sitemap.mjs` 生成，接入 `npm run check:sitemap`。

#### 日期从哪来：为什么最终没用 git log

直觉方案是 `git log -1 --format=%cs -- <file>`，但它**在自测里活不下来**：
`tests/node/checks.test.mjs` 把仓库复制到临时目录后只做 `git init && git add -A`（不提交），
git 历史为空，日期会退回文件 mtime——而副本的 mtime 是复制那一刻，
于是「干净副本必须通过」这条基线必然失败。

改用**内容哈希 + 提交进仓库的日期清单**（`scripts/sitemap-lastmod.json`）：

- 页面内容哈希与清单一致 → 沿用清单里的日期（页面没变，日期不该变）
- 页面内容哈希变了 → 取当天日期并回写清单

不依赖 git、结果确定，因此可以在 CI 与自测里被校验。初始清单用真实 git 历史做种，
只让本次实际改动过的 4 个页面取当天。

#### 一个被自己抓到的自相矛盾

第一版把瞬态的 `changed` 标记也写进了清单，于是第二次运行它会由 `true` 变 `false`，
清单内容随之改变，`--check` 立刻报「不一致」——生成器自己和自己打架。
是第一次 `--check` 抓到的，现在有幂等性用例守着。

#### 顺序规则

不写死页面清单，避免新增页面时要改两个地方：首页 → `tools/` 按 `index.html` 卡片顺序
→ 其余按路径字母序。完整性由 `check-syntax` 兜底（漏收页面直接报错）。

### 顺手修掉一个静默失效的用例

`check-syntax 能查出 sitemap 漏收页面` 原先按 `<changefreq>/<priority>` 的旧格式写死匹配串。
sitemap 改成 `<lastmod>` 之后模式匹配不上，`patch` **静默变成空操作**——
用例照常「通过」，实际上什么都没验证。已改为新格式，并先断言样本串存在。

这类静默失效比失败更危险，与项目里「裁判本身也要被检查」是同一条理由。
本次新增的用例都带上了这条前置断言。

### 测试与检查

- 端到端用例 109 → **130 条**；校验脚本自测 26 → **32 条**
- `npm run check` 从四项扩到**五项**（新增 `check:sitemap`）
- 反向验证：撤掉三处修复后，**10 条新断言变红**（按需加载 2、键盘 5、二维码 3），
  恢复后重新变绿

#### 一条跑了才会发现的坑：套件为什么一度「挂死」

第一次跑全量端到端时，1 小时没有任何输出，看起来像测试挂死。
查进程才发现四个 worker 都是空转（CPU 累计只有几秒），浏览器进程早已不存在——
是上面那条 `filechooser` 用例把 worker 卡住了。改用 `--trace=off` 跑完之后一切正常：
**130 条用例 5 分钟跑完**，与之前的一小时形成对比。

顺带记录一个与代码无关的观察：`trace` 默认开启时，每个用例都在往磁盘写录屏帧，
在 Windows 上还会出现 `EPERM ... -recording19.network`（写 trace 文件被系统拦下）。
本地排查时用 `--trace=off` 能省大量时间。

### 修复超大图片会静默产出空白图（canvas 单边 16384 硬上限）

先量再改——这次量出的是一个此前没人注意到的**真缺陷**。

浏览器 canvas 单边超过 **16384** 时**不会抛错**，但 `drawImage` 会静默变成空操作：
实测 16384 可用，16385 起 `fillRect` 照常返回、而 `getImageData` 读回全透明。
而三个图片工具都是「照搬原图尺寸建 canvas」，`maxDim` 的默认值又是 0（不限制）——

> 用户塞进一张 20000px 宽的图，工具会「成功地」交出一张**全透明空白图**，
> 全程不报任何错。产物是坏的，而全链路显示成功。

其中 `image-watermark` 最严重：它写死 `decodeImage(file, 0)`，**无条件**不做任何限制。

耗时完全不是问题（实测 108 百万像素只要 871ms），所以这不是性能取舍，纯粹是没兜住。

#### 修复

- `LK.decodeImage()` 现在会把尺寸兜回上限内（用户给的 `maxDim` 与平台上限取更小者），
  并返回 `clamped` 标记。**修在共享辅助函数里，一处覆盖三个图片工具。**
- 三个图片工具在结果行显示「超出浏览器上限，已缩小」（新增共享词条 `common.downscaled`），
  避免用户以为输出尺寸没变。
- `image-watermark` 的测试钩子原本是**发后不管**的（不 await、不返回值），
  调用方无从判断「何时算完」。现改为与其他文件型工具一致：等待处理结束并返回产出数量。

#### 测试

- 新增夹具 `sample-huge.png`（20000×64）。**这个尺寸用 canvas 造不出来**
  （canvas 自己就超限了），只能用 PNG 编码器直接写。
- 新增 4 个用例，其中核心一条直接读回像素：
  `expect(r.alpha).toBe(255)` —— 绘制若变成空操作，alpha 会是 0。
  这是对缺陷本身的断言，而不是对「尺寸是否被改小」这类间接指标。
- 已用「撤掉修复」验证：**4 条中失败 3 条**（像素断言 + 两处界面提示），
  而负向对照「未超限不显示提示」照常通过——符合预期。

### text-diff：内存减半、修正规模上限语义、修掉一处残留结果的缺陷

先做了实测（Chromium，本机），再决定改什么——因为原先的判断是错的：

- 此前文档断言「20000 行会到 GB 级内存」，但代码里本来就有 `MAX_LINES = 5000` 守卫，
  那个场景**根本触发不到**。实测最坏情况（5000×5000，守卫上限）是 **419ms / 97.7MB**，
  并不像描述的那样危险。**把一个不存在的崩溃当成优化论据，是这次要改掉的习惯。**

#### 修复

- **超限时旧结果不会被清掉。** 守卫触发后只设了错误提示，
  而 `#output` 里的差异行与 `#stats` 里的统计仍是上一次的——**看起来就像本次输入算出来的**。
  边界测试正是被这一点误导过（5001 / 8000 行读出的统计与 5000 行一模一样）。
  现统一走 `clearResult()`，并加了会真正失败的回归用例。

#### 变更

- **规模上限改为按「计算量」限制**：`MAX_LINES`（每侧 5000 行）→ `MAX_CELLS = 25e6`。
  LCS 的代价是 `n×m` 而不是 `max(n,m)`，旧规则会把「5001 行 vs 5 行」这种
  几乎不花钱的对比也拒掉。现另设 `MAX_LINES = 20000` 单侧上限，
  但它卡的是**输出规模**（每行一个 DOM 节点），与计算量无关。
  提示文案同步改为说明两条规则（`td.toolarge` 中英各一份）。

#### 性能

- **LCS 的长度表由 `Uint16` 存储**（原 `Uint32`）。值不会超过 `min(n,m)`，
  在 `MAX_CELLS` 约束下远小于 65535，不会溢出；**输出完全不变**，内存直接减半：

  | 规模 | 优化前 | 优化后 |
  |---|---|---|
  | 2000×2000 | 71ms / 16.9MB | 67ms / 9.3MB |
  | 5000×5000 | 419ms / 97.7MB | 380ms / 49.9MB |

#### 测试

- 新增 3 个用例：
  - **差异可还原出两侧原文**——「把差异应用回原文必须得到修改后的文本」。
    这条不变量**与具体算法无关**，任何最小差异实现都必须满足，
    因此它是将来更换算法（如线性空间的 Hirschberg）时的安全网。
  - 超限输入会先清掉上一次的结果（已用「撤掉修复即失败」验证过它真能抓到该缺陷）。
  - 不对称输入不再被「行数」规则误拒。

#### 未做（附理由）

未改为 Hirschberg 线性空间实现。它能把空间降到 `O(min(n,m))`，
但**时间常数约为 2 倍**——在内存本来就只有 50MB、且守卫已限住规模的前提下，
这是笔不划算的交易。若将来要大幅提高上限，再连同 Worker 一起做。

### 冒烟检查增加部署收敛等待

#### 修复

- **`npm run smoke` 在 CI 上会把「还没部署」误报成「部署错了」。**
  该 job 在 push 后几秒就开始跑，而 Cloudflare Pages 往往还没部署完——
  实测遇到一次：push 后 12 秒跑冒烟时 `canonical` 组全红，两分钟后再跑全绿。
  现增加 `--wait <秒>` 选项（CI 用 `--wait 180`）：反复重试直到通过或预算耗尽。
  **预算耗尽仍失败即判定为真的不一致，照常失败**——是等待收敛，不是掩盖问题。

### 更正地址形态：无扩展名才是最终地址

#### 更正

- **上一版文档声称「在 Cloudflare Pages 设置里关闭 Pretty URLs」——该设置不存在。**
  核实结论（官方社区与文档一致）：`/foo.html` → `/foo` 的 308 跳转是**平台硬编码行为，
  没有配置开关**。一位 Cloudflare MVP 的原话是 "There's no supported way to prevent Pages
  today from removing the .html file extension"；社区里也有用户专门为此开帖请求开放开关。
  也就是说，上一轮选定的「保留 .html」方案在该平台上无法实现，
  而文档把用户引向了一个不存在的入口。

#### 变更

- **地址形态改为「无扩展名即最终地址」**，顺着平台走而不是对抗它。
  全站 46 处「自身地址」声明统一改为无扩展名形式：

  | 载体 | 数量 |
  |---|---|
  | `<link rel="canonical">` | 24（错误页不设） |
  | `<meta property="og:url">` | 2 |
  | JSON-LD 里的 `"url"` | 20 |
  | `sitemap.xml` 的 `<loc>` | 24（含根路径 1 条不变） |

  第一轮迁移只改了 canonical 与 sitemap，漏掉了 og:url 与 JSON-LD——
  三者是同一份信息的三个载体，漏掉任何一个都等于对搜索引擎给出互相矛盾的页地址。
  现已在 `check-syntax` 中把三者一起校验，不会再漏。
- **`scripts/serve.mjs` 复现平台的 URL 行为**，使本地与线上一致：
  `/foo.html` → 308、`/index.html` → `/`、无扩展名 → 解析到同名 `.html` 文件；
  未找到时返回 `404.html` 的内容（与关闭 SPA fallback 后的行为一致）。
- **`scripts/smoke.mjs` 的 `urlform` 组期望值反转**：不再断言「`.html` 应返回 200」
  （那是基于错误假设），改为断言平台的真实行为——`.html` 308 到无扩展名、无扩展名返回 200。
  `canonical` 组同步增加了「不得带 `.html`」的断言。
- 文档同步更正：README 与 CONTRIBUTING 的「地址形态」一节重写，部署清单里删掉了
  「关闭 Pretty URLs」这一步，并说明为什么不需要也无法配置。

#### 明确保留的取舍

站内链接仍写作 `.html`（如 `href="privacy.html"`），每次点击会多一次 308 跳转。
之所以不改成无扩展名：那会让「双击 `index.html` 直接打开」失效——`file://` 下不存在
名为 `privacy` 的文件，而这是本项目已验证并对外说明的能力。取舍已记入 CONTRIBUTING。

### Node 版本要求收紧到 ≥ 22

#### 变更

- **`engines.node` 从 `>=20.11` 改为 `>=22`，CI 矩阵去掉 Node 20。**
  起因是 CI 在 Node 20 上失败了，而报错信息完全没有指向真正的原因：
  `Could not find '.../tests/node/**/*.test.mjs'`。
  实际原因是 **`node --test` 的 glob 参数要到 Node 21 才支持**，Node 20 会把 `**`
  当成字面路径。也就是说，`engines` 声称支持的版本上，`npm run test:checks` 根本跑不通——
  **声称支持却跑不通，比明确不支持更糟**。
  而 Node 20 已于 **2026-04-30 EOL**（官方不再提供安全修复），为一个无补丁的运行时
  做兼容没有意义，因此直接收紧要求。
- 新增 `.npmrc` 并开启 `engine-strict=true`：版本不符时会在 `npm install` 阶段
  以明确信息失败，而不是等到某个命令抛出指向错误的异常。

### 生产环境守卫与图片压缩修复

#### 新增

- **`scripts/smoke.mjs`：生产站点冒烟检查**（`npm run smoke`）。
  这是唯一会访问线上环境的检查，因此不放进默认的 `check`。分七组：`pages` / `urlform` /
  `headers` / `cache` / `thirdparty` / `boundary` / `canonical`，支持 `--only <组>` 单跑。
  它的价值在于探测**仓库看不到的东西**——Cloudflare 控制台的设置没有版本控制，
  只能靠线上断言发现。其中两点尤其重要：
  - `cache` 分组从 `_headers` 读取**声明值**再与线上实际响应头逐一比对，而不是硬编码期望值；
  - `thirdparty` 分组是唯一能发现 Cloudflare 边缘注入 `beacon.min.js` 的手段
    （仓库里根本没有这段代码）。该分组只检查**会被加载的资源**（script/link/img…），
    刻意不含 `<a href>`——外链是站点正常内容，算进来会造成假警报。
- `tests/fixtures/sample.gif`（1×1、2 色调色板的最小合法 GIF89a）与 `sample.bmp`
  （8×8 24 位无压缩），由 `make-fixtures.mjs` 手工构造，用于覆盖不可编码格式的处理路径。
- `check-deploy` 新增「缓存策略必须全站一致」检查：要求 `_headers` 对通配路径声明
  `Cache-Control`，且其值里 `max-age` 只出现一次——防止有人为了性能又加回按路径规则
  （那会导致同名响应头被 Cloudflare 逗号合并）。

#### 修复

- **`compress-image` 会产出 `xxx-min.img` 这类文件**。
  根因比「兜底值写得难看」更麻烦：浏览器 canvas 只能编码 JPEG / WebP / PNG，
  其它格式交给 `canvas.toBlob()` 时**会静默回退成 PNG**——实测确认请求 `image/gif`
  得到的是 `image/png`。而原代码照着输入类型去查扩展名表，查不到就兜底成 `img`，
  于是扩展名与实际字节从来就没对上过。
  现改为：把不可编码的输入**显式替换为 PNG**，扩展名只从可编码白名单推导（三种，无兜底），
  `-min` 后缀依据「输出类型 === 规范化后的输入类型」判断，并在结果行显示替换说明。
  用默认设置拖入 GIF/BMP 即可复现原缺陷，因此这是默认路径上的问题。
- **首页把图片压缩描述成「压到目标大小」**，而工具只有质量滑块与最大尺寸两个控制项。
  改为「按质量与最大尺寸压缩 JPG、PNG 与 WebP」，与实现一致。
  （若将来真要支持目标大小，可对质量做二分搜索实现，届时应单独立项而不是沿用现在的文案。）
- 工具页的投放提示改为明示「GIF 与 BMP 将输出为 PNG」，与新的替换行为对齐。

### 站点可达性与错误页

#### 新增

- **HSTS**：`_headers` 增加 `Strict-Transport-Security: max-age=15552000`。
  此前 http→https 虽有 301，但首次请求仍是明文，可被 SSL-stripping 利用。
  取值刻意不含 `includeSubDomains` 与 `preload`：前者给将来新增子域留余地，
  后者一旦进浏览器内置列表几乎无法撤回。**注意 HSTS 只应在 `_headers` 一处配置**，
  若同时在 Cloudflare 控制台开启，响应头会被逗号合并成非法值而被浏览器整条忽略。
- **`404.html`**：带 `noindex`、不设 canonical、不进 sitemap。
  Cloudflare Pages 在未找到路径时自动使用它（需在设置中关闭 SPA fallback 才会生效）。
- **canonical 与 sitemap 一致性检查**（`scripts/check-syntax.mjs`）：
  校验每个页面的 canonical 等于其自身地址、sitemap 每条 URL 都能映射到真实文件、
  收录全部可索引页面且不含错误页。

#### 变更

- **明确地址形态为「保留 `.html` 扩展名」**（即关闭 Cloudflare Pages 的 Pretty URLs）。
  Pretty URLs 会把 `/foo.html` 308 跳到 `/foo`，而页面的 canonical 与 sitemap 里写的是 `.html`——
  等于 canonical 指向了一个非最终地址。关闭后三者天然一致，本地开发服务器行为也与线上一致。
  该决定已由 `check:syntax` 强制，不再只是文档中的约定。
  代价：已存在的无扩展名链接（如外部引用的 `/privacy`）会 404。

#### 修复

- **`_headers` 里误加的 `*/`**：`/*` 是「匹配所有路径」的通配模式，格式中并没有 C 风格的块结束符。
  此前按注释习惯补了 `*/` 收尾，被解析成一条模式为 `*/` 的空规则（规则数虚增为 2）。
  现已移除，并新增一条检查：每条规则的首行模式必须像 URL 路径，否则报错。
- **Playwright 把 `tests/node/checks.test.mjs` 也当成了自己的用例文件**：
  该文件名匹配 Playwright 默认的 `*.test.mjs`，于是每次跑端到端都会额外加载它一遍——
  Playwright 在其中找不到自己的用例，但 `node:test` 的 24 个自测会照常跑完，
  把 TAP 输出混进结果，并让套件多花约 30 秒。已在 `playwright.config.js` 中加
  `testIgnore: ['node/**']`，两个测试入口从此互不干扰。

### 部署配置修复与工程化补强

#### 修复

- **`_headers` 的 `Cache-Control` 实际未生效**：Cloudflare Pages 对多条规则命中的同名响应头是
  **逗号合并**而非覆盖。原先三条规则都设置 `Cache-Control`，导致 vendor 文件收到
  `public, max-age=0, must-revalidate, public, max-age=31536000, immutable, public, max-age=3600`
  一串互相冲突的指令，预期的 `immutable` 根本没生效。现收敛为单条通配规则。
- **开发产物被公开服务**：Cloudflare Pages 以仓库根目录作为发布目录，实测
  `/tests/fixtures/sample.pdf`、`/package.json`、`/scripts/vendor.json`、`/.github/workflows/ci.yml`、
  `/README.md` 等均以正确的 MIME 类型返回给公网。现新增 `_redirects` 逐条屏蔽。
- **本地测试环境与线上语义不一致**：`scripts/serve.mjs` 自行实现的响应头合并用的是「后覆盖前」，
  与 Cloudflare 官方的「逗号合并」相反，导致上面第一个缺陷在本地怎么测都测不出来。
  现改为与校验脚本共用 `scripts/lib/deploy-config.mjs`，并让本地服务器一并执行 `_redirects`。
- 修正 `_headers` 里「同名的后一条覆盖前一条」这条与官方文档相反的错误注释。
- **`npm run test:checks` 在 Linux 上无法运行**：`node --test tests/node/` 的目录形式会被
  Node 当成模块去执行（`Cannot find module .../tests/node`），Windows 上同样失败。
  改用 glob 形式 `node --test "tests/node/**/*.test.mjs"`。
  这个疏漏本身也值得一提——本地验证时我习惯直接传文件路径，从未跑过 `package.json` 里
  真正的那个命令，于是「验证方式」与「被验证的对象」不是同一个东西。CI 抓到了它。

#### 新增

- **`scripts/check-deploy.mjs`**：校验 `_redirects` 状态码合法性（Cloudflare Pages 不支持
  404 / 410，写了会被静默忽略）、`_headers` 同名响应头重叠、以及开发产物的屏蔽覆盖率。
- **`tests/node/checks.test.mjs`**：17 个自测用例，用「坏样本」证明四个校验脚本确实会报错。
  裁判本身也需要被验证——此前 `check-i18n` 的死键检测就因把字典文件也纳入搜索范围而形同虚设，
  会静默地返回「全部通过」，比没有检查更危险。
- `eslint.config.js` 与 ESLint 依赖：浏览器侧统一按 ES2020 检查，开启 `no-var` / `prefer-const` / `eqeqeq`。
- `.github/pull_request_template.md` 与 `.github/ISSUE_TEMPLATE/`。
- `_redirects`：屏蔽开发产物的重定向规则。

#### 变更

- `assets/i18n.js` 与 `assets/app.js` 中残留的 `var` 统一为 `const` / `let`，
  语言基线正式定为 **ES2020** 并由 lint 强制。
  （注：此前报告称「`app.js` 与 `i18n.js` 都是 ES5 风格」并不准确——`app.js` 本就以 ES6 为主，
  只有 `injectSponsor` 一个函数里残留 `var`；真正整体使用 `var` 的是 `i18n.js`。）

### 审计修复（commit 9a2e808）

#### 修复

- **隐私口径自相矛盾**：`privacy.html` 与 `index.html` 的静态源码写着「靠 Google AdSense 广告维持」
  并提到 EEA 同意弹窗，而 `assets/i18n.js` 的字典写的是「完全没有广告，靠自愿赞助」，两者互相否定。
  且站内既没有 AdSense 脚本、也没有任何同意弹窗。现统一为「无广告、靠自愿赞助」口径。
- **隐私政策把 HTML 标记当纯文本显示**：`priv.eea` 用 `data-i18n`（写 `textContent`），
  但字典值含 `<a>` 标签，导致页面上直接显示出标签源码。已删除该冗余词条与对应段落。
- **输入框提示语从不翻译**：6 个工具页使用了 `data-i18n-ph`，但 `i18n.js` 的 `apply()`
  从未处理该属性，切到中文后占位符仍是英文，6 条翻译成为孤儿词条。已在运行时接线。
- **`config.repo` 形同虚设**：`donate.html` 的内联脚本早于 i18n 翻译执行，
  `getElementById('repoLink')` 拿到 `null`；即便拿到，翻译完成后也会把硬编码 href 写回来。
  现改为注册到新增的 `LKI.onApply` 回调，在每次翻译落地后重新应用配置。
- **页脚隐私链接词条错用**：24 个页面的页脚复用了头部导航的 `nav.privacy`，
  导致静态文案（Privacy Policy）与字典值（Privacy）在每一页都不一致。现为页脚新增 `footer.privacy`。
- **文件名未转义即拼入 `innerHTML`**：5 个工具页（压缩图片、格式转换、批量水印、PDF 合并、PDF 转图片）
  把文件名直接拼进 `innerHTML`，而同一仓库的文本对比与密码生成却做了转义，规范不统一。
  现统一走新增的 `LK.esc()`。
- **`pdf-to-docx` 的段落/表格描述与实际能力不符**：字典里把它说得比实现更笼统，
  现改为与实现一致的「带框线表格从 PDF 自身边框线读取」表述。
- `donate.html` 的 meta description 仍写着已被移除的「扫描二维码赞助」。
- 删除 `donate.html` 中残留的空 `<style></style>` 块。
- `docx-to-pdf` 的状态提示「— ready.」为硬编码英文，未走 i18n，现补 `dp.ready` 词条。

### 变更

- **第三方依赖全部本地化**：9 个库从 jsDelivr CDN 改为随仓库提交的 `assets/vendor/`。
  由此消除供应链风险与访问者的 IP 外泄，并让「断网可用」覆盖到 PDF 与图片处理工具。
  新增 `scripts/vendor.json` 与 `scripts/update-vendor.mjs` 管理版本与 sha256 校验。
- **新增 CSP 等安全响应头**（`_headers`）：其中 `connect-src 'none'` 在浏览器层面强制禁止本站发起网络请求。
  本地与 CI 的测试服务器 `scripts/serve.mjs` 会读取并下发同一套响应头，保证测试环境与线上一致。
- README 的「20+ 个工具」改为准确表述「20 个工具」；技术栈补齐遗漏的 `js-md5` 披露（About 页同步）。

### 新增

- **端到端测试与 CI**：Playwright 用例覆盖 20 个工具的核心逻辑，并额外把三件事变成可自动验证的约束——
  全站零第三方请求、断网后工具仍可用、带 HTML 的文件名不会被当作标签解析。
  GitHub Actions 在 push / PR 时运行静态检查与测试。
- **i18n 一致性门禁** `scripts/check-i18n.mjs`：校验中英字典键对齐、引用无悬空、
  **静态兜底文案与字典英文逐字一致**、无死键。首次运行即查出 42 处既有不一致。
- **静态检查** `scripts/check-syntax.mjs`：JS 与内联脚本语法、JSON-LD 合法性、
  本地资源引用完整性、无第三方 CDN 引用残留。
- **测试夹具生成器** `tests/fixtures/make-fixtures.mjs`：零依赖手工构造 PNG / PDF（含带框线表格的 PDF）/ DOCX，
  供文件类工具测试使用。
- `CONTRIBUTING.md`、`SECURITY.md`、`.editorconfig`、`package.json`。
- `assets/vendor/README.md`：记录各库版本、许可证与升级方式。

### 移除

- 字典中 7 个确认无人引用的死键：`priv.eea`、`pg.weak`、`pg.ok`、`pg.strong`、`pg.vault`、`ug.copy`、`tsp.ms`。
- `pdf-to-docx.html` 中 `__lkConvert` 重复实现的一整套转换流水线（约 50 行）——
  现改为复用主流程的 `dryRun` 模式，避免两处发散。

## 2026-09-13

- 站点 URL 切换为自有域名 youngray.asia。

## 2026-09-12

- 首发版本：20 个纯浏览器端工具，中英双语，MIT 许可。
- 清理失效的 `.btn` 选择器，把 `config.repo` 接入仓库链接，为 20 个工具补测试钩子。
- 移除二维码赞助区块，联系方式改为 GitHub Issues。
- 赞助页合规改造（商户收款码 + 法律声明 + 可选爱发电）。
