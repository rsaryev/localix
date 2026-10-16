/// <reference path="./turndown-vendor.d.ts" />
/**
 * Readability-based main-content extraction for the web tools.
 *
 * Two-stage pipeline with a graceful fallback:
 *   1. `linkedom` parses the HTML into a lightweight DOM (NOT jsdom).
 *   2. `@mozilla/readability` isolates the article body (drops nav/header/
 *      footer/sidebars/cookie chrome), then for `markdown` mode the article HTML
 *      is rendered with the SAME `turndown` (+ GFM) already used by the docx
 *      document driver — no parallel converter. `text` mode returns the article's
 *      plain text.
 *
 * Whenever Readability can't help — a null parse, a tiny/JSON/minimal body, a
 * missing dynamic import, or anything thrown — this falls back to the pure
 * `htmlToText` regex pipeline. It NEVER throws and always returns usable text, so
 * behaviour is identical to today for pages Readability can't parse.
 *
 * The heavy libs load via dynamic `import()` on first use (mirrors the documents
 * drivers), so no DOM parser or turndown loads at boot.
 */
import { htmlToText, extractTitle } from './html-text'

/** Hard cap on input HTML we hand to Readability (DoS guard — a full DOM is allocated). */
const MAX_HTML_CHARS = 1_000_000
/** Below this, Readability isn't worth a DOM allocation (JSON APIs, error pages, stubs). */
const MIN_READABLE_CHARS = 200
/** Readability's own char floor for accepting a result — lowered from its 500 default. */
const READABILITY_CHAR_THRESHOLD = 200

export interface ReadableResult {
  /** Extracted body — Markdown or plain text depending on `mode`. */
  text: string
  /** Article/document title when one was found. */
  title?: string
}

/** CommonJS/ESM interop: unwrap a `default` when the lib is `export =`. */
function unwrap<T = unknown>(mod: unknown): T {
  const m = mod as { default?: unknown }
  return (m?.default ? m.default : mod) as T
}

/**
 * Give the parsed document a base URL so Readability resolves relative hrefs/srcs
 * to absolute ones. linkedom exposes `baseURI` as a getter-only accessor, so we
 * shadow it (and `documentURI`) with an own data property; any failure is ignored
 * — relative links simply survive as-is.
 */
function setDocumentUrl(document: unknown, url: string): void {
  for (const prop of ['baseURI', 'documentURI'] as const) {
    try {
      Object.defineProperty(document, prop, { value: url, configurable: true, writable: true })
    } catch {
      /* getter-only with no shadowing allowed — leave relative links untouched */
    }
  }
}

/** Render article HTML to Markdown with the shared turndown + GFM (dynamically imported). */
async function htmlToMarkdown(html: string): Promise<string> {
  const TurndownService = unwrap<
    new (o?: Record<string, unknown>) => {
      turndown: (h: string) => string
      use: (p: unknown) => unknown
    }
  >(await import('turndown'))
  const gfmMod = (await import('turndown-plugin-gfm')) as {
    gfm?: unknown
    default?: { gfm?: unknown }
  }
  const gfm = gfmMod.gfm ?? gfmMod.default?.gfm
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
  if (gfm) td.use(gfm)
  return td.turndown(html)
}

/**
 * Extract the readable main content of an HTML page as Markdown or plain text.
 * Always resolves to a usable `{ text, title? }` — falls back to `htmlToText`
 * (with a `<title>` scrape) whenever Readability can't isolate an article.
 */
export async function extractReadable(
  html: string,
  url: string,
  mode: 'markdown' | 'text',
): Promise<ReadableResult> {
  const fallback = (): ReadableResult => {
    const title = extractTitle(html)
    return { text: htmlToText(html), ...(title ? { title } : {}) }
  }

  // DoS + not-worth-it guards handled cheaply by the regex fallback.
  if (html.length > MAX_HTML_CHARS || html.length < MIN_READABLE_CHARS) return fallback()

  try {
    const [readabilityMod, linkedomMod] = await Promise.all([
      import('@mozilla/readability'),
      import('linkedom'),
    ])
    const { Readability } = readabilityMod
    const { parseHTML } = linkedomMod
    const { document } = parseHTML(html)
    setDocumentUrl(document, url)

    const article = new Readability(document as unknown as Document, {
      charThreshold: READABILITY_CHAR_THRESHOLD,
    }).parse()
    if (!article?.content) return fallback()

    const title = (article.title ?? extractTitle(html) ?? '').trim() || undefined

    if (mode === 'text') {
      const text = (article.textContent ?? '').trim()
      if (!text) return fallback()
      return { text, ...(title ? { title } : {}) }
    }

    const markdown = (await htmlToMarkdown(article.content)).trim()
    if (!markdown) return fallback()
    return { text: markdown, ...(title ? { title } : {}) }
  } catch {
    return fallback()
  }
}
