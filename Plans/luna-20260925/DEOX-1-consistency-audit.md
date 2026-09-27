# DEOX site consistency audit (JOE-2169)

**Scope:** read-only comparison of `E:\DEOX\site-sandbox` with `E:\DEOX\site-live-mirror`, run 25 September 2026. No site files were changed.

## Executive summary

The sandbox contains the six requested top-level pages, but only **13** `regintel/*.html` articles (the request said 14). The shared visual language is mostly consistent: dark navy/black surface, Inter, blue/amber accents, 1100px page width, fixed navigation and shared footer. The main consistency risks are structural rather than cosmetic: article metadata is incomplete, article templates split into two materially different widths/styles, the index contains six links to files absent from the sandbox, and `.html` URLs are used everywhere without a documented canonical policy. Sandbox and live mirror are substantially divergent: 21 common files differ by SHA-256, one sandbox article is absent from the mirror, and the mirror contains 20 additional files.

## Inventory and method

| Scope | Result |
|---|---:|
| Sandbox top-level HTML pages | 6 (`about`, `index`, `kyber-ai`, `readiness-checklist`, `regintel`, `uk-sphere`) |
| Sandbox RegIntel articles | 13 |
| Sandbox total files | 23 |
| Live-mirror total files | 41 |
| Common files with differing SHA-256 | 21 |
| Common files with identical SHA-256 | 1 (`favicon.ico`) |

Checks covered inline design tokens, typography, navigation/footer markup, hero/card/CTA patterns, copy/metadata, local links, canonical and Open Graph tags, and a recursive SHA-256 comparison. Local links were resolved against the sandbox tree; external URLs and Cloudflare email-protection links were excluded from the local-dead-link result.

## Findings

| Severity | Page | Element | Current | Fix | Effort |
|---|---|---|---|---|---|
| High | `regintel.html` | Article inventory/links | Index has 19 unique article slugs. Six are absent from sandbox: `mhra-2025-process-improvements.html`, `ich-e6-r3-error-corrections-2025.html`, `fdora-2-clinical-trial-tech.html`, `brexit-regulatory-divergence-2026.html`, `real-world-evidence-regulatory-submissions.html`, `clinical-trial-insurance-uk-2026.html`. | Either add the six controlled articles or remove/replace the six cards and keep the index count truthful. | M |
| High | All 13 `regintel/*.html` | Canonical URL | No article has a `<link rel="canonical">`; top-level pages do. | Add one absolute canonical per article, e.g. `https://deox.co.uk/regintel/<slug>.html`, and document whether `.html` is the permanent URL policy. | S |
| High | All 13 `regintel/*.html` | OG metadata | No article has `og:title`, `og:description`, or `og:image`; top-level pages do. | Add a complete OG block derived from title/description and the shared brand image. | S |
| High | All 13 `regintel/*.html` | Contextual service backlink | After removing shared header/footer, zero articles link in body copy to `about.html`, `kyber-ai.html`, `readiness-checklist.html`, or `uk-sphere.html`. Existing matches are nav/mobile/footer only. | Add one relevant in-body CTA or inline contextual link per article (prefer readiness checklist or Kyber AI where relevant). | S |
| High | `regintel.html` | Local link health | Six article targets and `favicon.ico` are unresolved in the sandbox. The favicon is referenced by all six top-level pages and all 13 articles but is not present in the sandbox inventory. | Restore the favicon or remove the references; repair/remove the six dead article cards. | S/M |
| High | All 13 `regintel/*.html` | Date/author consistency | Newer article template shows `Updated/Published <date>` plus `DEOX Clinical Regulatory Team`; older template shows category tags + date only and no author. Index cards do not expose a normalized machine-readable date. | Normalize to one `<time datetime>` plus one author line, and use the same article-meta component across all articles. | M |
| Medium | `regintel/eu-ai-act-clinical-trials.html`, `fda-modernization-3-nams.html`, `ich-e6-r3-gcp.html`, `mhra-dct-framework.html`, `mhra-si-2024-1028.html`, `mhra-transparency-6-month.html` | Article shell | These six legacy articles use `--max-w:760px`, no `--orange-dim`, and a compact shell; the other seven use `--max-w:1100px`, `--orange-dim`, and the newer long-form shell. | Consolidate onto one article template; preserve 760px reading width as a child `.article-body` rather than a different page token set. | M |
| Medium | All top-level pages | Token ownership | Tokens are duplicated inline in every file. `--orange-dim` exists only on `readiness-checklist.html`, `regintel.html`, and seven newer articles. | Move tokens to one versioned stylesheet or generate pages from a shared partial; define the complete token set once. | M/L |
| Medium | All pages | Navigation/footer | Shared destinations are consistent, but nav is implemented as a `.nav` header plus a separate mobile menu and includes obfuscated email links. The article pages have the same destinations with `../` paths. | Keep one shared nav/footer partial and test desktop/mobile link parity automatically. | M |
| Medium | `index.html` | Hero/copy | Home hero says `Run your trial with the next generation CRO .` (space before punctuation); home copy mixes “AI-native”, “AI-powered”, “one platform replacing seven”, and regulatory claims. | Remove punctuation defect and establish a short voice/style sheet for capitalization, claim evidence, and hyphenation. | S |
| Low | `uk-sphere.html` | Metadata | Description is only `Explore the UK clinical trial landscape with DEOX Clinical`, materially thinner than the other top-level descriptions. | Replace with a specific value proposition and matching OG description. | S |
| Low | All pages | Accessibility/semantics | Hero/card/CTA patterns are present, but the audit found no consistent machine-readable article dates and no common metadata component. | Add semantic `<time>`, descriptive CTA labels, and a shared metadata test to CI. | M |
| Low | All pages | URL policy | Internal links intentionally retain `.html` (`index.html`, `regintel.html`, etc.), while canonical URLs are absolute. No redirect/extension policy is present in the sandbox. | Decide one policy (retain `.html` or redirect to extensionless), then make links, canonicals, sitemap, and redirects agree. | M |

## Pattern comparison

### Design tokens

The common base is strong: `--bg:#08080C`, `--teal:#2563EB`, `--orange:#F59E0B`, `--terracotta:#e07a5f`, `--text:#CBD5E1`, `--text-dim:#7C8BA5`, `--text-bright:#F1F5F9`, Inter, and `--max-w:1100px`. Exceptions are the six legacy articles at `--max-w:760px` and the inconsistent presence of `--orange-dim`. The page styles are all inline, so a token change requires editing many documents.

### Navigation/footer

All 19 HTML documents expose the same five primary destinations (Home, Kyber AI, UK Sphere, RegIntel, About), plus a contact link. Top-level paths are root-relative filenames; article paths use `../`. Each page has one footer. `readiness-checklist.html` has two nav matches because it includes both desktop and mobile navigation markup.

### Hero, cards, and CTAs

Top-level pages share page-hero/section/card/CTA conventions. The home page is intentionally denser (hero and service feature boxes); `kyber-ai.html` and `uk-sphere.html` are card-led; `regintel.html` is a card index; the checklist is interaction-heavy. Article pages use either the newer long-form “step row/lead box” shell or the older compact article shell. This is the largest component-pattern drift inside the sandbox.

### Copy voice

The consistent voice is direct, UK-sponsor-facing, operational, and action-oriented (“what you need to do”). Drift appears in metadata and claims: article titles alternate `DEOX Clinical` and `DEOX RegIntel`; author/date treatment differs; several legacy pages contain mojibake `€”` in visible copy; the home hero has a punctuation typo. Standardize the editorial fields and run UTF-8/typography linting.

## Sandbox local-link result

Unresolved local targets are:

| Source | Target |
|---|---|
| Every top-level page | `favicon.ico` |
| Every article | `../favicon.ico` |
| `regintel.html` | the six missing article slugs listed in the findings table |

All other local HTML links resolve within the sandbox. Cloudflare email-protection URLs, Google Fonts, and Cloudflare Insights were treated as external dependencies.

## Sandbox vs live-mirror drift

SHA-256 was calculated for every file present under each root. `site-live-mirror` is not a byte-identical deployment of the sandbox.

| Drift class | Files |
|---|---:|
| Sandbox files absent from mirror | 1 (`regintel/safeguarding-uk-human-genomic-data.html`) |
| Mirror-only files | 20 (listed below) |
| Common files with changed hash | 21 |
| Common files identical | 1 (`favicon.ico`) |

**Mirror-only files:** `_headers`, `contact.html`, `sop-vault.html`, `robots.txt`, `sitemap.xml`, `manifest.webmanifest`, `icon.svg`, `og-card.svg`, `uk-map.js`, `deox-logo-proper.png`, `img/deox-logo.png`, `functions/INDEX.md`, `functions/_middleware.js`, `regintel/INDEX.md`, `regintel/ai-regulation-national-commission-2026.html`, `regintel/uk-health-bill-mhra-reform-2026.html`, and the three mirror audit/support documents under the root (`CROSS-PAGE-AUDIT.md`, `CROSS-PAGE-DELTA-AUDIT-2026-08-15.md`, `CROSS-PAGE-DESIGN-DIRECTION-AUDIT-2026-08-07.md`).

**Changed common files:** `about.html`, `index.html`, `kyber-ai.html`, `readiness-checklist.html`, `regintel.html`, `uk-sphere.html`, all 13 common RegIntel article HTML files, `deox-logo-new.png`, `INDEX.md`, and `regintel/INDEX.md`. The only identical common file is `favicon.ico`.

## Recommended order

1. Repair the six dead index cards and restore/resolve the favicon (High).
2. Publish one metadata/backlink component for all articles (canonical, OG, `<time>`, author, one contextual service CTA) (High).
3. Decide and document the `.html` URL/canonical/redirect policy (High/Medium).
4. Consolidate legacy and current article shells and centralize design tokens (Medium).
5. Reconcile sandbox and live mirror from a declared source of truth; keep the SHA-256 drift check in release CI (Medium).

