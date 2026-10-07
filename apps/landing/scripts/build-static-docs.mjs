import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@localixai/markdown/react'
import { hasMathSyntax, loadMathPlugins, extractMarkdownHeadings } from '@localixai/markdown'
import { renderDocsShell } from './render-docs.tsx'
import { makeMdComponents } from '../src/pages/docs/markdownComponents.tsx'
import { docPages, loadDocContent } from '../src/generated/docs.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultDistDir = path.resolve(__dirname, '../dist')
const SITE_ORIGIN = 'https://localix.ai'

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function replaceMeta(html, key, name, value) {
  const pattern = new RegExp(`(<meta\\s+${key}="${name}"\\s+content=")[^"]*("\\s*/?>)`, 'u')
  if (!pattern.test(html)) throw new Error(`Missing ${key} metadata: ${name}`)
  return html.replace(pattern, `$1${escapeHtml(value)}$2`)
}

function resolveDocHref(href, page, pages) {
  if (!href || /^(?:https?:|mailto:|tel:|#|\/)/u.test(href)) return href
  const [pathname, hash] = href.split('#')
  if (!pathname.endsWith('.md') || !page.sourcePath) return href
  const repoPath = path.posix.normalize(
    path.posix.join(path.posix.dirname(page.sourcePath), pathname),
  )
  const target = pages.find((candidate) => candidate.sourcePath === repoPath)
  return target ? `/docs/${target.slug}${hash ? `#${hash}` : ''}` : href
}

/** Render useful article HTML for crawlers and no-JavaScript readers. */
export function renderStaticMarkdown(content, page, pages = docPages) {
  const heading =
    (tag) =>
    ({ children, id }) =>
      React.createElement(tag, { id }, children)
  return renderToStaticMarkup(
    React.createElement(
      Markdown,
      {
        headingIds: true,
        components: {
          ...makeMdComponents(page.sourcePath ?? 'docs/index.md', () => {}),
          h1: heading('h1'),
          h2: heading('h2'),
          h3: heading('h3'),
          // Static readers can see every variant without needing the client tab controls.
          'answer-tabs': ({ children }) => React.createElement('div', null, children),
          'answer-tab': ({ children, 'data-label': label }) =>
            React.createElement('section', null, React.createElement('h4', null, label), children),
          a: ({ href, children }) => {
            const resolved = resolveDocHref(href, page, pages)
            return React.createElement('a', { href: resolved }, children)
          },
        },
      },
      content,
    ),
  )
}

/** Turn the built application shell into a crawlable, page-specific docs shell. */
export function renderStaticDocHtml(template, page, bodyHtml = '', content = '') {
  const title = `${page.title} · Localix Docs`
  const url = `${SITE_ORIGIN}/docs/${encodeURIComponent(page.slug)}`
  let html = template
    .replace(/<title>[^<]*<\/title>/u, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<link rel="canonical" href="[^"]*" \/>/u,
      `<link rel="canonical" href="${escapeHtml(url)}" />`,
    )

  html = replaceMeta(html, 'name', 'description', page.summary)
  html = replaceMeta(html, 'property', 'og:type', 'article')
  html = replaceMeta(html, 'property', 'og:url', url)
  html = replaceMeta(html, 'property', 'og:title', title)
  html = replaceMeta(html, 'property', 'og:description', page.summary)
  html = replaceMeta(html, 'name', 'twitter:title', title)
  html = replaceMeta(html, 'name', 'twitter:description', page.summary)

  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.summary,
    url,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Localix',
      url: `${SITE_ORIGIN}/`,
    },
  }).replaceAll('<', '\\u003c')
  html = html.replace(
    /(<script type="application\/ld\+json">)[\s\S]*?(<\/script>)/u,
    `$1\n      ${structuredData}\n    $2`,
  )
  const headings = extractMarkdownHeadings(content).filter(
    (heading) => heading.depth === 2 || heading.depth === 3,
  )
  const active = {
    section: 'getting-started',
    sectionTitle: 'Documentation',
    sourcePath: 'docs/index.md',
    order: 0,
    ...page,
  }
  const shell = renderDocsShell(active, bodyHtml, headings)
  const bootstrap = JSON.stringify({ slug: page.slug, content, headings }).replaceAll(
    '<',
    '\\u003c',
  )
  return html.replace(
    '<div id="root"></div>',
    `<div id="root">${shell}</div><script type="application/json" id="doc-bootstrap">${bootstrap}</script>`,
  )
}

/**
 * Put the rendered homepage into the shell. `data-prerendered` tells `main.tsx` to hydrate this
 * markup instead of replacing it, which is only correct because it came from the same route table.
 */
export function renderStaticHomeHtml(template, markup) {
  return template.replace(
    '<div id="root"></div>',
    `<div id="root" data-prerendered="home">${markup}</div>`,
  )
}

export async function buildStaticDocs({
  distDir = defaultDistDir,
  pages = docPages,
  loadContent = loadDocContent,
  // Loaded lazily: the renderer imports the app through the `@/` alias, which only resolves when
  // Bun runs from this directory, so a caller outside the build (a test) supplies its own.
  renderHome = async () => (await import('./render-home.tsx')).renderHomeMarkup(),
} = {}) {
  const template = await fs.readFile(path.join(distDir, 'index.html'), 'utf8')
  const docsDir = path.join(distDir, 'docs')
  await fs.mkdir(docsDir, { recursive: true })
  const expectedFiles = new Set(pages.map((page) => `${page.slug}.html`))

  for (const entry of await fs.readdir(docsDir)) {
    if (entry.endsWith('.html') && !expectedFiles.has(entry)) {
      await fs.rm(path.join(docsDir, entry), { force: true })
    }
  }

  for (const page of pages) {
    if (!/^[0-9A-Za-z-]+$/u.test(page.slug)) {
      throw new Error(`Unsafe documentation slug: ${page.slug}`)
    }
    const content = await loadContent(page.slug)
    if (hasMathSyntax(content)) await loadMathPlugins()
    await fs.writeFile(
      path.join(docsDir, `${page.slug}.html`),
      renderStaticDocHtml(template, page, renderStaticMarkdown(content, page, pages), content),
      'utf8',
    )
  }

  await fs.writeFile(
    path.join(distDir, 'index.html'),
    renderStaticHomeHtml(template, await renderHome()),
    'utf8',
  )
  console.log(`[docs:static] emitted ${pages.length} page-specific HTML shells`)
}

if (import.meta.main) {
  buildStaticDocs().catch((error) => {
    console.error('[docs:static] failed:', error)
    process.exit(1)
  })
}
