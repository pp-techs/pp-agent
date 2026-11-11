# PP Agent website

Marketing site and documentation for [PP Agent](https://github.com/pp-techs/pp-agent), served at
**https://ppagent.monback.app** (English at `/`, Vietnamese at `/vi/`).

## Stack

- [Astro](https://astro.build) — static output, zero JavaScript by default.
- [Starlight](https://starlight.astro.build) — docs layout, sidebar, Pagefind search, dark mode,
  sitemap, i18n, and Markdown/MDX content.
- Cloudflare Workers static assets — no server logic, no backend.
- `sharp` at build time for screenshot variants.

The site is the `@workspace/website` package in the pnpm workspace. Dependencies come from the
root catalog, and `apps/website/**` is excluded from `vp check` because Astro's own toolchain
handles those files. `vp run -r build` builds the site along with the apps.

## Commands

Run from the repository root:

```sh
vp install
vp run --filter @workspace/website dev       # http://localhost:4321
vp run --filter @workspace/website build     # static output in apps/website/dist/
vp run --filter @workspace/website preview
vp run --filter @workspace/website deploy    # build + deploy to Cloudflare Workers
```

Deployment requires a Cloudflare login with access to the `Monback` account and the
`monback.app` zone:

```sh
npx wrangler login
```

The catalog pins `astro@7.4.8` and `wrangler@4.159.0` instead of the newest releases because
the workspace's `minimumReleaseAge` supply-chain guard rejects versions published within a day.
Bump the pins deliberately.

## Content

English documentation lives in `src/content/docs/docs/`; Vietnamese translations live under
`src/content/docs/vi/docs/` with the same file names. The URL follows the path:
`vi/docs/install.md` becomes `/vi/docs/install/`.

Navigation is defined in `astro.config.mjs` under `sidebar`, with group labels translated via
`translations: { vi: '…' }`. Page titles and descriptions come from frontmatter, so the
Vietnamese sidebar labels are the translated page titles.

The landing pages are `src/pages/index.astro` and `src/pages/vi/index.astro`, both rendering
`src/components/Landing.astro`. Copy lives in `src/i18n/landing.ts`; add a key to both languages
when changing the page.

To add a docs page:

1. Create `src/content/docs/docs/<slug>.md` and `src/content/docs/vi/docs/<slug>.md` with
   `title` and `description` frontmatter.
2. Add `{ slug: 'docs/<slug>' }` to the right sidebar group in `astro.config.mjs`.
3. Build and check both `/docs/<slug>/` and `/vi/docs/<slug>/`.

## Theme

The Starlight theme is defined in `src/styles/starlight.css`:

- the same Geist typeface and ink/mist/sky palette as the landing page;
- light and dark tokens for navigation, sidebar, content, tables, asides, cards, and pagination;
- a branded hero panel on the documentation landing page;
- `github-light` / `github-dark` code themes via Expressive Code;
- the horizontal logo lockup replacing the text title.

The docs use Starlight's built-in language picker and its Vietnamese UI strings.

## SEO

- Canonical URLs, Open Graph/Twitter tags, and `hreflang` alternates for both languages.
- `@astrojs/sitemap` writes `sitemap-index.xml`; `public/robots.txt` points to it.
- Structured data (WebSite and SoftwareApplication) is inlined on the landing pages.
- `public/og.png` is a 1200×630 social image.

## Deployment

`wrangler.jsonc` deploys `dist/` as an assets-only Worker and binds the custom domain
`ppagent.monback.app`. The `workers.dev` endpoint is disabled so the custom domain is the only
host.

`public/_headers` adds security headers and long-lived caching for `/_astro/*` and the Pagefind
index. The custom 404 page is `src/content/docs/404.md`; Starlight also injects a `/404` route,
so the build prints a route-priority warning while the generated `404.html` uses the custom
content.
