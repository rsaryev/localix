import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams, useNavigate } from 'react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { docPages, loadDocContent } from '@/generated/docs'
import { ButtonLink } from '../components/Button'
import { PAGE_SHELL } from '../lib/shell'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { extractHeadings, featureCategoryFor, makeMdComponents } from './docsNav'
import { DocsBreadcrumb, DocsPagination } from './docs/DocsArticleNav'
import { DocsMobilePicker } from './docs/DocsMobilePicker'
import { DocsSidebar } from './docs/DocsSidebar'
import { DocsTableOfContents } from './docs/DocsTableOfContents'
import { useDocMetadata } from './docs/useDocMetadata'
import { useDocSearch } from './docs/useDocSearch'

function scrollDocumentToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

function DocNotFound() {
  return (
    <div className={`${PAGE_SHELL} flex flex-col items-center py-28 text-center`}>
      <p className="font-heading text-5xl font-semibold tracking-tight text-text-faint">404</p>
      <h1 className="mt-4 font-heading text-2xl font-semibold tracking-tight">
        Documentation page not found
      </h1>
      <p className="mt-2 max-w-prose text-text-soft">
        This page may have moved. Browse the current documentation instead.
      </p>
      <ButtonLink to="/docs" variant="outline" className="mt-8">
        Browse docs
      </ButtonLink>
    </div>
  )
}

export function DocsPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const search = useDocSearch()

  const active = useMemo(() => docPages.find((page) => page.slug === slug), [slug])
  const [activeContent, setActiveContent] = useState<string | null>(null)
  const [contentFailed, setContentFailed] = useState(false)
  const articleRef = useRef<HTMLElement>(null)
  const previousSlug = useRef(slug)
  const focusAfterLoad = useRef(false)

  useEffect(() => {
    if (!active) return
    let current = true
    setActiveContent(null)
    setContentFailed(false)
    void loadDocContent(active.slug).then(
      (content) => {
        if (current) setActiveContent(content)
      },
      () => {
        if (current) setContentFailed(true)
      },
    )
    return () => {
      current = false
    }
  }, [active])

  // Reset scroll to the top when navigating between docs pages.
  useEffect(() => {
    if (previousSlug.current !== slug) {
      focusAfterLoad.current = true
      previousSlug.current = slug
      scrollDocumentToTop()
    }
  }, [slug])

  useEffect(() => {
    if (activeContent === null) return
    const targetId = location.hash.slice(1)
    if (targetId) {
      const target = document.getElementById(targetId)
      target?.scrollIntoView({ block: 'start' })
      target?.focus()
      focusAfterLoad.current = false
    } else if (focusAfterLoad.current) {
      focusAfterLoad.current = false
      articleRef.current?.focus({ preventScroll: true })
      scrollDocumentToTop()

      // Run once more after layout so browser scroll restoration or a late
      // Markdown height change cannot put Previous/Next back at the old offset.
      const frame = window.requestAnimationFrame(scrollDocumentToTop)
      return () => window.cancelAnimationFrame(frame)
    }
  }, [activeContent, location.hash])

  useDocMetadata(active)

  const headings = useMemo(
    () => (activeContent ? extractHeadings(activeContent) : []),
    [activeContent],
  )
  const components = useMemo(
    () => (active ? makeMdComponents(active.sourcePath, (to) => void navigate(to)) : undefined),
    [active, navigate],
  )

  if (!active) return <DocNotFound />

  const flatIndex = docPages.findIndex((page) => page.slug === active.slug)
  const previous = flatIndex > 0 ? docPages[flatIndex - 1] : null
  const next = flatIndex < docPages.length - 1 ? docPages[flatIndex + 1] : null
  const activeCategory = active.section === 'features' ? featureCategoryFor(active) : null

  return (
    <div className={`${PAGE_SHELL} flex gap-10 py-12`}>
      <DocsSidebar active={active} search={search} />

      <article
        id="doc-content"
        ref={articleRef}
        tabIndex={-1}
        className="min-w-0 flex-1 outline-none"
      >
        <DocsMobilePicker active={active} search={search} />
        <DocsBreadcrumb active={active} category={activeCategory} />

        <div className="docs-prose">
          {contentFailed ? (
            <p>Could not load this documentation page. Please refresh and try again.</p>
          ) : activeContent === null ? (
            <LoadingHint className="min-h-48 p-0">Loading documentation…</LoadingHint>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
              {activeContent}
            </ReactMarkdown>
          )}
        </div>

        <DocsPagination previous={previous} next={next} />

        <p className="mt-8 text-xs text-text-faint">
          Source: <code className="text-text-soft">{active.sourcePath}</code> · auto-generated from
          the repo docs.
        </p>
      </article>

      <DocsTableOfContents headings={headings} />
    </div>
  )
}
