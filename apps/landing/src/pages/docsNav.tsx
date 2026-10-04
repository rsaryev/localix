import { isValidElement, useRef, useState } from 'react'
import { highlight } from 'sugar-high'
import { docPages, type DocPage } from '@/generated/docs'
import { screenshotAssets } from '@/generated/shots'
import { slugifyDocHeading } from '@/lib/docHeading'

// The public manifest owns category assignment; this list controls display order.
const FEATURE_CAT_ORDER = [
  'Core',
  'Workspace',
  'Workbenches',
  'Media',
  'Models & context',
  'Memory & skills',
  'Integrations',
  'More',
] as const
type FeatureCategory = (typeof FEATURE_CAT_ORDER)[number]

export function featureCategoryFor(page: DocPage): FeatureCategory {
  return FEATURE_CAT_ORDER.includes(page.category as FeatureCategory)
    ? (page.category as FeatureCategory)
    : 'More'
}

export function groupByCategory(pages: DocPage[]) {
  const map = new Map<FeatureCategory, DocPage[]>()
  for (const p of pages) {
    const cat = featureCategoryFor(p)
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(p)
  }
  return FEATURE_CAT_ORDER.flatMap((c) => (map.has(c) ? [{ title: c, pages: map.get(c)! }] : []))
}

export function groupBySection(pages: DocPage[]) {
  const map = new Map<string, { title: string; pages: DocPage[] }>()
  for (const p of pages) {
    if (!map.has(p.section)) map.set(p.section, { title: p.sectionTitle, pages: [] })
    map.get(p.section)!.pages.push(p)
  }
  return [...map.values()]
}

/** Flatten a markdown node's children to their plain text (elements → their own children). */
function nodeText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => nodeText(child as React.ReactNode)).join('')
  if (isValidElement(node)) {
    return nodeText((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

export interface Heading {
  depth: 2 | 3
  text: string
  id: string
}

/** Build a table of contents from the page's h2/h3 (ignores fenced code). */
export function extractHeadings(content: string): Heading[] {
  const out: Heading[] = []
  let inFence = false
  for (const line of content.split('\n')) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^(#{2,3})\s+(.+)$/)
    if (!m) continue
    const text = m[2].replace(/[`*_]/g, '').trim()
    out.push({ depth: m[1].length as 2 | 3, text, id: slugifyDocHeading(text) })
  }
  return out
}

const SLUG_SET = new Set(docPages.map((p) => p.slug))
const SCREENSHOT_ASSETS = screenshotAssets as Readonly<
  Record<string, { src: string; capturedAt: string }>
>

/** Resolve a relative href to a repo-root-relative path (handles ../, ./,
 *  docs/, leading /), relative to the page it appears on. */
function resolveRepoPath(href: string, currentSourcePath: string): string {
  const clean = href.split('#')[0].split('?')[0]
  if (clean.startsWith('/')) return clean.replace(/^\/+/, '')
  if (clean.startsWith('docs/')) return clean
  const stack = currentSourcePath.split('/').slice(0, -1)
  for (const part of clean.split('/')) {
    if (part === '..') stack.pop()
    else if (part !== '.') stack.push(part)
  }
  return stack.join('/')
}

/** A repo path → generated doc slug, or null if it isn't a known doc page. */
function pathToSlug(repoPath: string): string | null {
  if (!repoPath.endsWith('.md')) return null
  const slug = repoPath
    .replace(/^docs\//, '')
    .replace(/\.md$/, '')
    .replace(/\//g, '--')
  return SLUG_SET.has(slug) ? slug : null
}

// ReactMarkdown overrides (per page so links resolve relative to it): stable
// heading ids for the TOC, sugar-high code, and internal-link rewriting.
/**
 * A doc image that removes itself if the file is not there.
 *
 * Screenshot slots are declared in the markdown before the capture exists, so the
 * page can be written ahead of the photograph. Rendering the browser's broken-image
 * icon for those would be worse than showing nothing: it reads as a site defect
 * rather than as a shot that has not been taken. The prose is written to stand on
 * its own, so omitting the figure loses nothing.
 */
function DocImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
}

const CODE_LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Shell',
  css: 'CSS',
  html: 'HTML',
  js: 'JavaScript',
  json: 'JSON',
  jsonc: 'JSON with comments',
  markdown: 'Markdown',
  md: 'Markdown',
  sql: 'SQL',
  text: 'Plain text',
  ts: 'TypeScript',
  tsx: 'TSX',
}

function DocCodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [copyAttempt, setCopyAttempt] = useState(0)
  const copyRequest = useRef(0)
  const text = nodeText(children).replace(/\n$/, '')
  const childClassName = isValidElement(children)
    ? ((children.props as { className?: string }).className ?? '')
    : ''
  const language = childClassName.match(/language-([A-Za-z0-9_-]+)/)?.[1] ?? 'text'
  const languageLabel = CODE_LANGUAGE_LABELS[language] ?? language.toUpperCase()

  const copy = async () => {
    const request = ++copyRequest.current
    setCopied(false)
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(text)
      if (request !== copyRequest.current) return
      setCopied(true)
    } catch {
      if (request !== copyRequest.current) return
      setCopyAttempt((attempt) => attempt + 1)
      setCopyFailed(true)
    }
  }

  return (
    <div className="docs-code-block">
      <div className="docs-code-toolbar">
        <span>{languageLabel}</span>
        <button type="button" onClick={() => void copy()} aria-label="Copy code">
          {copied ? 'Copied' : copyFailed ? 'Retry copy' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
      <span className="sr-only" aria-live="polite">
        {copied
          ? 'Code copied to clipboard.'
          : copyFailed
            ? `Could not copy code. Try again. Attempt ${copyAttempt}.`
            : ''}
      </span>
    </div>
  )
}

export function makeMdComponents(sourcePath: string, navigate: (to: string) => void) {
  return {
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 id={slugifyDocHeading(nodeText(children))} tabIndex={-1}>
        {children}
      </h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 id={slugifyDocHeading(nodeText(children))} tabIndex={-1}>
        {children}
      </h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 id={slugifyDocHeading(nodeText(children))} tabIndex={-1}>
        {children}
      </h3>
    ),
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      if (!src) return null
      if (/^(https?:|data:)/.test(src)) return <DocImage src={src} alt={alt ?? ''} />
      const repoPath = resolveRepoPath(src, sourcePath)
      const asset = SCREENSHOT_ASSETS[repoPath]
      if (!asset) return null
      return <DocImage src={asset.src} alt={alt ?? ''} />
    },
    pre: ({ children }: { children?: React.ReactNode }) => <DocCodeBlock>{children}</DocCodeBlock>,
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="docs-table-scroll">
        <table>{children}</table>
      </div>
    ),
    code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
      const text = nodeText(children)
      const isBlock = /language-/.test(className ?? '') || text.includes('\n')
      if (!isBlock) return <code>{children}</code>
      return (
        <code
          className={className}
          dangerouslySetInnerHTML={{ __html: highlight(text.replace(/\n$/, '')) }}
        />
      )
    },
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      // A markdown link with no destination is not a link. Rendering a bare `<a>` produced an
      // element that is announced as one and goes nowhere; the text is the whole content.
      if (!href) return <>{children}</>
      // in-page anchor
      if (href.startsWith('#')) {
        return <a href={href}>{children}</a>
      }
      // external / mailto
      if (/^(https?:|mailto:)/.test(href)) {
        const ext = href.startsWith('http')
        return (
          <a href={href} target={ext ? '_blank' : undefined} rel={ext ? 'noreferrer' : undefined}>
            {children}
          </a>
        )
      }
      // Relative links to public docs keep client-side navigation. Any other
      // relative link remains an ordinary link instead of becoming inert text.
      const repoPath = resolveRepoPath(href, sourcePath)
      const docSlug = pathToSlug(repoPath)
      if (docSlug) {
        const hash = href.includes('#') ? `#${href.split('#')[1]}` : ''
        const destination = `/docs/${docSlug}${hash}`
        return (
          <a
            href={destination}
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              navigate(destination)
            }}
          >
            {children}
          </a>
        )
      }
      return <a href={href}>{children}</a>
    },
  }
}
