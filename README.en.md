# LocalKit · Local-first free online tools

> **Free online tools that never upload your files.**
> 20 fully client-side tools: image compression / conversion / watermarking, PDF merge / split / to-image,
> two-way Word↔PDF conversion, QR codes, JSON, text diff, hashing, passwords and more.
> Everything runs 100% in your browser — no uploads, no accounts, no tracking, no third-party requests.

[Live site →](https://youngray.asia) · [GitHub →](https://github.com/LLL-Ricar-9257) · [中文说明](README.md)

## Features

- 🔒 **Privacy first** — every tool is a small program running inside your browser tab. Files never leave your device.
- 📴 **Fully offline-capable** — all libraries are vendored into the repository. Every tool (PDF and image processing included) works with the network disconnected.
- 🚫 **Zero third-party requests** — no CDN, no analytics, no ads. Visitors never leak an IP to a third party by using this site.
- ⚡ **Instant** — no upload queue; processing runs at your device's speed.
- 🆓 **Free and unlimited** — no account, no watermark, no quota. Funded by voluntary donations.
- 🌐 **Bilingual** — English and Chinese, switchable, follows the browser language by default.
- 📦 **Zero build** — plain static HTML/CSS/JS. Clone and serve; drag-and-drop deploy to Cloudflare Pages / Vercel / GitHub Pages.

## Tools

| Category | Tools |
|---|---|
| 🖼️ Images | Compress (batch + ZIP), Convert (PNG/JPG/WebP), Text watermark (batch), QR generator (link/text/Wi-Fi) |
| 📄 Documents | Merge PDF, Split PDF, PDF to Image, DOCX to PDF, PDF to Word (table grid + image reconstruction) |
| 📝 Text | Text diff (line-level LCS), Case converter (10 formats), Text statistics (CJK-aware) |
| 💻 Developer | JSON to TypeScript, JSON formatter/validator, Base64 & URL (Unicode-safe), Hash calculator (MD5 + SHA family), Password generator, UUID v4, Timestamp converter, Color converter |

## Run locally

The site is fully static and **needs no build**. Any static server works:

```bash
python -m http.server 8080
npx serve .

node scripts/serve.mjs 4173    # zero-dependency server shipped with the repo; also serves the _headers security headers
```

Open `http://localhost:8080`. You can also just double-click `index.html` — every path is relative.

## Deploy

1. Fork or clone this repository.
2. [Cloudflare Pages](https://pages.dev) → Create → connect the repo (or drag-and-drop the folder).
3. **Set Caching → Configuration → Browser Cache TTL to "Respect Existing Headers".**
   This is the easiest step to miss and the most confusing when you do — see below.
4. Bind a custom domain and replace `youngray.asia` in `index.html`, `tools/*.html`, and `sitemap.xml`.
   Also replace it in the `og:image` / `twitter:image` tags — social crawlers do not resolve relative URLs.
5. Add a `www` subdomain and a `www` → apex 301 redirect rule if you want one.
6. Make sure **Web Analytics is off** — it injects `beacon.min.js`, which contradicts the zero-third-party-script promise.
7. Configure donation channels in `assets/config.js` (GitHub by default; Afdian optional).

After deploying, run `npm run smoke` to verify the live site.

### Why Browser Cache TTL must be disabled

Cloudflare's zone-level **Browser Cache TTL (4 hours) overrides the `max-age` declared in `_headers`**,
and it applies **only to non-HTML assets** — HTML is unaffected. That asymmetry is exactly why it is hard to spot:
pages look fine, but `assets/*.js`, `*.css` and `vendor/*` silently become 4-hour cached.

The consequence: for up to 4 hours after a deploy, returning visitors get **new HTML + old dictionaries**.
The browser considers its cached `i18n.js` fresh, never revalidates, the new page references keys the old
dictionary lacks, and `LKI.t()` falls back to the key name — so the footer literally renders `footer.privacy`.

`npm run smoke` has a dedicated `[cache]` group guarding this: it reads the declared values from `_headers`
and compares them against the live response headers, naming the exact header and where to fix it.

### URL shape: extensionless is canonical

Cloudflare Pages **308-redirects `/foo.html` to `/foo`**. This is not configurable — it is hardcoded in the
platform. So the correct move is to go with it: treat the extensionless URL as final, and keep one single
URL shape across the site.

All four of these must use the extensionless form and must agree:

| Carrier | Location | Example |
|---|---|---|
| `canonical` | each page's `<head>` | `https://youngray.asia/privacy` |
| `og:url` | each page's `<head>` | `https://youngray.asia/privacy` |
| `url` | each page's JSON-LD | `https://youngray.asia/tools/hash-calculator` |
| `<loc>` | `sitemap.xml` | `https://youngray.asia/privacy` |

`npm run check:syntax` verifies all 69 carrier slots: each must point at this site, must equal the page's own
final URL, and must not carry `.html`. **A missing carrier is an error too** — it used to be skipped silently,
which let 23 of 24 pages ship without any `og:url` at all.

`scripts/serve.mjs` reproduces these platform behaviours locally so local and production agree:
`.html` → 308, `/index.html` → `/`, extensionless → resolves to the matching `.html` file.

### 404 page

`404.html` at the repository root is used automatically by Cloudflare Pages for unmatched paths
(provided SPA fallback is off). It carries `noindex` and is excluded from `sitemap.xml`.
If SPA fallback is enabled, every unknown path returns the homepage with a 200 (a soft-404) and
`404.html` never runs — turn SPA fallback off in Pages settings.

### HSTS lives in exactly one place

`_headers` already sends `Strict-Transport-Security`. Do **not** also enable the HSTS toggle in the
Cloudflare dashboard (SSL/TLS → Edge Certificates): when both are set, the response header is comma-joined
into `max-age=15552000, max-age=...`, which is invalid and may be ignored entirely by browsers —
the exact opposite of the intent.

## Tech stack

Zero framework, zero build. **9** third-party libraries, all downloaded into `assets/vendor/` and committed
(versions pinned exactly, with sha256 checksums; see `scripts/vendor.json`):

[PDF.js](https://github.com/mozilla/pdf.js) · [pdf-lib](https://github.com/Hopding/pdf-lib) · [docx](https://github.com/dolanmiu/docx) · [JSZip](https://github.com/Stuk/jszip) · [html2canvas](https://github.com/niklasvh/html2canvas) · [jsPDF](https://github.com/parallax/jsPDF) · [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) · [js-md5](https://github.com/emn178/js-md5)

Each library keeps its original license; see `assets/vendor/README.md`.

Heavy libraries are **lazily loaded** via `LK.loadScript()` — only when a tool actually needs them.
`tools/pdf-to-docx.html` and `tools/docx-to-pdf.html` each dropped from ~290 KB / ~250 KB gzip
to ~51 KB / ~45 KB on first paint.

Inspired by [it-tools](https://github.com/CorentinTh/it-tools) and [omni-tools](https://github.com/iib0011/omni-tools). Thanks to the open-source community.

## Development and testing

The site itself needs no Node, but development and testing do (**Node ≥ 22**; Node 20 reached EOL in
April 2026 and is no longer supported). These dependencies serve local checks and CI only — they never
enter the deployed artifact.

```bash
npm install

npm run check        # static checks (i18n / syntax / deploy config / vendor hashes / sitemap)
npm run lint         # ESLint
npm run test:checks  # self-test of the check scripts (bad-sample injection)
npm run smoke        # probes the live site: cache policy, zero third-party scripts, security headers
npm test             # Playwright end-to-end tests (starts a local server automatically)
npm run serve        # local preview server only
npm run gen:sitemap  # regenerate sitemap.xml (with lastmod) after editing pages
```

`npm run smoke` is the only check that touches the live site, so it is **not** part of the default `check`.
It is split into `pages` / `urlform` / `headers` / `cache` / `thirdparty` / `boundary` / `canonical` groups;
run one with `npm run smoke -- --only cache`. Its value is probing what the repository cannot see —
Cloudflare dashboard settings (Browser Cache TTL, Web Analytics, SPA fallback) are not version-controlled,
so only live assertions can catch them.

CI runs `npm run smoke -- --wait 180`, because that job starts seconds after a push while Cloudflare Pages
is usually still deploying. The wait budget is **bounded**: if it expires and the check still fails,
that is treated as a real inconsistency.

`npm run check` covers five things:

- `check:i18n` — dictionary key parity between languages, no dangling key references,
  **static fallback copy matching the English dictionary**, and no dead keys. The page source and the
  runtime dictionary are two copies of the same sentence; this is the gate that stops them drifting.
- `check:syntax` — JS and inline-script syntax, JSON-LD validity, existence of every referenced local
  resource, the `og:image` / `og:url` / `twitter:card` metadata, lazily-loaded vendor paths,
  and any remaining third-party CDN reference.
- `check:deploy` — duplicate response headers in `_headers` (Cloudflare comma-joins them into conflicting
  directives), unsupported status codes in `_redirects`, and **whether all dev artifacts are shielded**
  (otherwise `tests/` and `scripts/` get published alongside the site).
- `check:vendor` — sha256 of every file in `assets/vendor/` against the manifest.
- `check:sitemap` — `sitemap.xml` against the output of `scripts/gen-sitemap.mjs`. `<lastmod>` must follow
  page changes; hand-maintained dates always drift, so a content-hash manifest drives it
  (`scripts/sitemap-lastmod.json`).

`npm run test:checks` is a health check for the check scripts themselves: it copies the repo to a temp
directory, injects **known defects** one at a time, and asserts the scripts actually fail. Without that
layer, a broken check would silently report "all passed" — worse than having no check at all.

### Deployment boundary

`tests/`, `scripts/`, `package.json` and friends live in the same directory as the site, and Cloudflare
Pages publishes the repository root — so by default they are served as site assets. `_redirects` blocks them.
**When you add a root-level development file, add a rule for it**; `npm run check:deploy` fails if you forget.

## Contributing

Issues and PRs are welcome. Adding a tool takes three steps: an HTML page, a card on the homepage, and
bilingual copy in `assets/i18n.js`. Then run `npm run gen:sitemap`.

Read [CONTRIBUTING.md](CONTRIBUTING.md) first (currently written in Chinese) — it covers the three i18n
attribute forms, the escaping conventions, and which checks to run before committing.

## License

[MIT](LICENSE)
