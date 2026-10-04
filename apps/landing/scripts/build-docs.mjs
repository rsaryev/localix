// Build the exact public documentation set declared by docs/public-nav.json.
// Unlisted repository internals never enter the landing navigation, search, static
// pages, or sitemap.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { slugifyDocHeading } from '../src/lib/docHeading.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const docsRoot = path.join(repoRoot, 'docs')
const publicNavFile = path.join(docsRoot, 'public-nav.json')
const outFile = path.join(__dirname, '../src/generated/docs.ts')
const contentDir = path.join(__dirname, '../src/generated/docs-pages')
const sitemapFile = path.join(__dirname, '../public/sitemap.xml')
let atomicWriteSequence = 0

/** Replace one generated file atomically. Parallel Turbo tasks may both invoke
 * docs:gen; a direct write or whole-directory rm lets one observe the other's
 * half-written tree. Sibling temp files + rename keep every visible file complete. */
async function writeFileAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${atomicWriteSequence++}.tmp`,
  )
  try {
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, file)
  } finally {
    await fs.rm(temp, { force: true })
  }
}

const titleCase = (s) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function deriveTitle(raw, frontTitle, file) {
  if (frontTitle) return frontTitle
  const h1 = raw.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  return titleCase(path.basename(file, '.md'))
}

export function truncateSummary(value, maxLength = 240) {
  const normalized = value.trim()
  if (normalized.length <= maxLength) return normalized

  const prefix = normalized.slice(0, maxLength - 1)
  const lastSpace = prefix.lastIndexOf(' ')
  const readablePrefix =
    lastSpace >= Math.floor(maxLength * 0.6) ? prefix.slice(0, lastSpace) : prefix
  return `${readablePrefix.replace(/[,:;.!?–—-]+$/u, '')}…`
}

function firstParagraph(body) {
  const lines = body.split('\n')
  const out = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) {
      if (out.length) break
      continue
    }
    if (t.startsWith('#') || t.startsWith('|') || t.startsWith('```')) {
      if (out.length) break
      continue
    }
    out.push(t)
  }
  return truncateSummary(
    out
      .join(' ')
      .replace(/[*`_>]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'),
  )
}

export function flattenPublicNav(manifest) {
  if (!manifest || !Array.isArray(manifest.sections)) {
    throw new Error('Documentation public nav must contain a sections array')
  }

  const entries = []
  const seen = new Set()
  const appendPages = (pages, section, category) => {
    if (!Array.isArray(pages)) {
      throw new Error(`Documentation public nav section "${section.id}" must contain pages`)
    }
    for (const pagePath of pages) {
      if (
        typeof pagePath !== 'string' ||
        !pagePath.endsWith('.md') ||
        pagePath.includes('\\') ||
        path.posix.isAbsolute(pagePath) ||
        pagePath.split('/').includes('..')
      ) {
        throw new Error(`Unsafe documentation public path: ${String(pagePath)}`)
      }
      if (seen.has(pagePath)) {
        throw new Error(`Duplicate documentation public path: ${pagePath}`)
      }
      seen.add(pagePath)
      entries.push({
        path: pagePath,
        section: section.id,
        sectionTitle: section.title,
        category,
        order: entries.length,
      })
    }
  }

  for (const section of manifest.sections) {
    if (
      !section ||
      typeof section.id !== 'string' ||
      !/^[a-z0-9-]+$/u.test(section.id) ||
      typeof section.title !== 'string' ||
      !section.title.trim()
    ) {
      throw new Error('Documentation public nav contains an invalid section')
    }
    if (section.pages) appendPages(section.pages, section)
    if (section.categories) {
      if (!Array.isArray(section.categories)) {
        throw new Error(`Documentation public nav section "${section.id}" has invalid categories`)
      }
      for (const category of section.categories) {
        if (!category || typeof category.title !== 'string' || !category.title.trim()) {
          throw new Error(`Documentation public nav section "${section.id}" has invalid category`)
        }
        appendPages(category.pages, section, category.title)
      }
    }
    if (!section.pages && !section.categories) {
      throw new Error(`Documentation public nav section "${section.id}" is empty`)
    }
  }

  return entries
}

/** Markdown outside fenced/inline code, where link syntax is actually navigable. */
function navigableMarkdown(source) {
  return source.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
}

/**
 * A screenshot slot that has not been captured yet. These are declared in the docs
 * ahead of the capture on purpose — you should be able to write the page for a
 * feature before you photograph it — so a missing one is a content gap to work
 * through, not a broken build. They are reported, never fatal, and the renderer
 * omits the image rather than showing a broken icon.
 *
 * Everything else stays fatal: a typo in a doc link is a real defect.
 */
const PENDING_SHOT = `docs${path.sep}assets${path.sep}screenshots${path.sep}`

/**
 * Fail the docs build on a broken repository-relative link or image.
 *
 * The landing rewrites links at render time, which previously made a typo look
 * like a valid GitHub URL until a reader clicked it. External URLs and in-page
 * anchors remain intentionally offline-safe and are not fetched here.
 *
 * Returns the list of uncaptured screenshot slots so the build can report them.
 */
export async function validateRelativeDocLinks(pages, sourceRoot) {
  const failures = []
  const pending = new Set()
  const publicSources = new Set(pages.map((page) => page.sourcePath.split(path.sep).join('/')))
  for (const page of pages) {
    const markdown = navigableMarkdown(page.content)
    for (const match of markdown.matchAll(/(!?)\[[^\]]*\]\(([^)]+)\)/g)) {
      const isImage = match[1] === '!'
      const href = match[2].trim().replace(/^<|>$/g, '')
      if (!href || /^(?:https?:|mailto:|tel:|#|\/)/.test(href)) continue
      const pathname = href.split('#')[0].split('?')[0]
      let decoded = pathname
      try {
        decoded = decodeURIComponent(pathname)
      } catch {
        failures.push(`${page.sourcePath}: invalid URL encoding in ${href}`)
        continue
      }
      const target = path.resolve(path.dirname(path.join(sourceRoot, page.sourcePath)), decoded)
      try {
        await fs.access(target)
        const targetSource = path.relative(sourceRoot, target).split(path.sep).join('/')
        if (!isImage && !publicSources.has(targetSource)) {
          failures.push(
            `${page.sourcePath}: ${href} must be an ordinary absolute URL because it is not a public documentation page`,
          )
        }
      } catch {
        if (path.relative(sourceRoot, target).startsWith(PENDING_SHOT)) {
          const relativeTarget = path.relative(sourceRoot, target).split(path.sep).join('/')
          if (
            !/^docs\/assets\/screenshots\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*--(?:\d{4}-\d{2}-\d{2}|placeholder)\.png$/u.test(
              relativeTarget,
            )
          ) {
            failures.push(
              `${page.sourcePath}: screenshot path must be <feature>/<surface>--YYYY-MM-DD.png (or --placeholder.png): ${href}`,
            )
          } else {
            pending.add(path.relative(sourceRoot, target))
          }
        } else {
          failures.push(`${page.sourcePath}: ${href}`)
        }
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Invalid relative documentation links:\n${failures.join('\n')}`)
  }
  return [...pending].sort((a, b) => a.localeCompare(b))
}

function headingIds(content) {
  const ids = new Set()
  let inFence = false
  for (const line of content.split('\n')) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{1,6})\s+(.+)$/u.exec(line)
    if (!match) continue
    const text = match[2].replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1').replace(/<[^>]+>/gu, '')
    ids.add(slugifyDocHeading(text))
  }
  return ids
}

export function validateDocAnchors(pages) {
  const byPath = new Map(pages.map((page) => [page.sourcePath.split(path.sep).join('/'), page]))
  const idsByPath = new Map(
    [...byPath.entries()].map(([sourcePath, page]) => [sourcePath, headingIds(page.content)]),
  )
  const failures = []

  for (const page of pages) {
    const sourcePath = page.sourcePath.split(path.sep).join('/')
    for (const match of navigableMarkdown(page.content).matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
      const href = match[1].trim().replace(/^<|>$/gu, '')
      const hashIndex = href.indexOf('#')
      if (hashIndex < 0 || /^(?:https?:|mailto:)/u.test(href)) continue
      const pathname = href.slice(0, hashIndex).split('?')[0]
      let anchor = href.slice(hashIndex + 1)
      try {
        anchor = decodeURIComponent(anchor)
      } catch {
        failures.push(`${page.sourcePath}: invalid anchor encoding in ${href}`)
        continue
      }
      const targetPath = pathname
        ? path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), pathname))
        : sourcePath
      const targetIds = idsByPath.get(targetPath)
      if (targetIds && !targetIds.has(anchor)) {
        failures.push(`${page.sourcePath}: ${href}`)
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Broken documentation anchors:\n${failures.join('\n')}`)
  }
}

/**
 * Validate exact repository file paths quoted in public prose. Directory examples, globs, and
 * templated paths remain documentation rather than resolvable file references.
 */
export async function validateSourceReferences(pages, sourceRoot) {
  const failures = []

  for (const page of pages) {
    const prose = page.content.replace(/```[\s\S]*?```/g, '')
    for (const match of prose.matchAll(
      /`((?:apps|packages|plugins|scripts|config|docs)\/[^`\n]+)`/g,
    )) {
      const candidate = match[1].replace(/[:#]\d+(?:-\d+)?$/, '')
      if (!/\.[A-Za-z0-9]+$/.test(candidate) || /[<>{}*]|\.\.\.|\s→\s|\s\+\s|\|/.test(candidate)) {
        continue
      }

      try {
        await fs.access(path.join(sourceRoot, candidate))
      } catch {
        failures.push(`${page.sourcePath}: ${candidate}`)
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Broken documentation source references:\n${failures.join('\n')}`)
  }
}

export function buildSitemap(pages) {
  const urls = [
    { path: '/', priority: '1.0' },
    ...pages.map(({ slug }) => ({ path: `/docs/${encodeURIComponent(slug)}`, priority: '0.7' })),
  ]
  const body = urls
    .map(
      ({ path: pathname, priority }) =>
        `  <url><loc>https://localix.ai${pathname}</loc><priority>${priority}</priority></url>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

/**
 * Keep public examples readable and consistently renderable. Large source excerpts belong behind
 * links to the implementation; documentation should show the smallest useful example.
 */
export function validateCodeBlocks(pages, maxLines = 48) {
  const failures = []

  for (const page of pages) {
    let open
    const lines = page.content.split('\n')
    for (const [index, line] of lines.entries()) {
      const match = line.match(/^(`{3,})([^`]*)$/)
      if (!match) continue

      if (!open) {
        const language = match[2].trim().split(/\s+/)[0]
        if (!language) {
          failures.push(`${page.sourcePath}:${index + 1}: fenced code block has no language`)
        }
        open = { fenceLength: match[1].length, line: index + 1 }
        continue
      }

      if (match[1].length < open.fenceLength || match[2].trim()) continue
      const lineCount = index - open.line
      if (lineCount > maxLines) {
        failures.push(
          `${page.sourcePath}:${open.line}: code block has ${lineCount} lines (maximum ${maxLines})`,
        )
      }
      open = undefined
    }

    if (open) {
      failures.push(`${page.sourcePath}:${open.line}: fenced code block is not closed`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`Documentation code-block quality check failed:\n${failures.join('\n')}`)
  }
}

/**
 * Keep public guides scannable. Deep implementation histories belong in source control or an
 * internal subsystem note, not in one uninterrupted landing-page article.
 */
export function validateReadablePages(pages, { maxLines = 400, maxParagraphWords = 120 } = {}) {
  const failures = []

  for (const page of pages) {
    const lines = page.content.split('\n')
    if (lines.length > maxLines) {
      failures.push(`${page.sourcePath}: page has ${lines.length} lines (maximum ${maxLines})`)
    }

    let inFence = false
    let paragraph = []
    let paragraphLine = 1
    const flush = () => {
      if (paragraph.length === 0) return
      const wordCount = paragraph.join(' ').match(/\S+/g)?.length ?? 0
      if (wordCount > maxParagraphWords) {
        failures.push(
          `${page.sourcePath}:${paragraphLine}: prose block has ${wordCount} words ` +
            `(maximum ${maxParagraphWords})`,
        )
      }
      paragraph = []
    }

    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim()
      if (/^`{3,}/.test(trimmed)) {
        flush()
        inFence = !inFence
        continue
      }
      if (inFence) continue

      if (!trimmed || /^(?:#{1,6}\s|\||---$)/.test(trimmed)) {
        flush()
        continue
      }

      const listItem = trimmed.match(/^(?:[-*+]\s|\d+\.\s)(.*)$/)
      if (listItem) {
        flush()
        paragraphLine = index + 1
        paragraph = [listItem[1]]
        continue
      }

      if (paragraph.length === 0) paragraphLine = index + 1
      paragraph.push(trimmed.replace(/^>\s?/, ''))
    }
    flush()
  }

  if (failures.length > 0) {
    throw new Error(`Documentation readability check failed:\n${failures.join('\n')}`)
  }
}

export async function buildDocs({
  sourceRoot = repoRoot,
  sourceDocs = docsRoot,
  manifestFile = outFile,
  pageContentDir = contentDir,
  publicNav,
  navFile = publicNavFile,
} = {}) {
  const nav = publicNav ?? flattenPublicNav(JSON.parse(await fs.readFile(navFile, 'utf8')))

  const pages = []
  for (const entry of nav) {
    const file = path.join(sourceDocs, ...entry.path.split('/'))
    try {
      await fs.access(file)
    } catch {
      throw new Error(`Missing public documentation page: ${entry.path}`)
    }
    const raw = await fs.readFile(file, 'utf8')
    const { data, content } = matter(raw)
    const rel = path.relative(sourceRoot, file)
    const relFromDocs = path.relative(sourceDocs, file)
    const slug = relFromDocs.replace(/\.md$/, '').replace(/[\\/]/g, '--')
    const summary =
      typeof data.description === 'string'
        ? truncateSummary(data.description)
        : firstParagraph(content)
    pages.push({
      slug,
      section: entry.section,
      sectionTitle: entry.sectionTitle,
      category: entry.category,
      title: deriveTitle(content, data.title, file),
      summary,
      order: entry.order,
      sourcePath: rel,
      content,
    })
  }

  const slugs = new Set()
  for (const page of pages) {
    if (slugs.has(page.slug)) {
      throw new Error(`Duplicate generated documentation slug: ${page.slug}`)
    }
    slugs.add(page.slug)
  }

  validateCodeBlocks(pages)
  validateReadablePages(pages)
  validateDocAnchors(pages)
  await validateSourceReferences(pages, sourceRoot)
  const pendingShots = await validateRelativeDocLinks(pages, sourceRoot)
  if (pendingShots.length > 0) {
    console.log(`[docs:gen] ${pendingShots.length} screenshot slot(s) awaiting a capture:`)
    for (const shot of pendingShots) console.log(`  · ${shot}`)
  }

  await fs.mkdir(path.dirname(manifestFile), { recursive: true })
  await fs.mkdir(pageContentDir, { recursive: true })

  for (const page of pages) {
    await writeFileAtomic(
      path.join(pageContentDir, `${page.slug}.ts`),
      `// AUTO-GENERATED by scripts/build-docs.mjs — do not edit by hand.\nexport default ${JSON.stringify(page.content)}\n`,
    )
  }

  // Remove renamed/deleted pages only after every replacement is visible. Keep
  // sibling .tmp files: another concurrent generator may still be about to rename
  // one, and both invocations computed the same expected page set.
  const expectedPages = new Set(pages.map(({ slug }) => `${slug}.ts`))
  const generatedEntries = await fs.readdir(pageContentDir)
  await Promise.all(
    generatedEntries
      .filter((entry) => entry.endsWith('.ts') && !expectedPages.has(entry))
      .map((entry) => fs.rm(path.join(pageContentDir, entry), { force: true })),
  )

  const metadata = pages.map(({ content: _content, ...page }) => page)
  const loaders = pages
    .map(
      ({ slug }) =>
        `  ${JSON.stringify(slug)}: () => import(${JSON.stringify(`./docs-pages/${slug}.ts`)}).then((module) => module.default),`,
    )
    .join('\n')
  const banner = `// AUTO-GENERATED by scripts/build-docs.mjs — do not edit by hand.\n// Source: ${path.relative(sourceRoot, sourceDocs)} (${pages.length} pages).\n`
  const body = `export interface DocPage {\n  slug: string\n  section: string\n  sectionTitle: string\n  category?: string\n  title: string\n  summary: string\n  order: number\n  sourcePath: string\n}\n\nexport const docPages: DocPage[] = ${JSON.stringify(metadata, null, 2)}\n\nconst contentLoaders: Record<string, () => Promise<string>> = {\n${loaders}\n}\nconst contentCache = new Map<string, Promise<string>>()\nlet allContentPromise: Promise<ReadonlyMap<string, string>> | undefined\n\n/** Load one page body. Vite turns every generated module above into its own lazy chunk. */\nexport function loadDocContent(slug: string): Promise<string> {\n  const cached = contentCache.get(slug)\n  if (cached) return cached\n  const loader = contentLoaders[slug]\n  if (!loader) return Promise.reject(new Error(\`Unknown documentation page: \${slug}\`))\n  const content = loader()\n  contentCache.set(slug, content)\n  return content\n}\n\n/** Full-text search is exact, but pays its content cost only after the user searches. */\nexport function loadAllDocContent(): Promise<ReadonlyMap<string, string>> {\n  allContentPromise ??= Promise.all(\n    docPages.map(async ({ slug }) => [slug, await loadDocContent(slug)] as const),\n  ).then((entries) => new Map(entries))\n  return allContentPromise\n}\n`
  await writeFileAtomic(manifestFile, banner + body)
  console.log(
    `[docs:gen] collected ${pages.length} lazy pages → ${path.relative(sourceRoot, manifestFile)}`,
  )

  return { pages, manifestFile, pageContentDir }
}

if (import.meta.main) {
  buildDocs()
    .then(({ pages }) => writeFileAtomic(sitemapFile, buildSitemap(pages)))
    .catch((err) => {
      console.error('[docs:gen] failed:', err)
      process.exit(1)
    })
}
