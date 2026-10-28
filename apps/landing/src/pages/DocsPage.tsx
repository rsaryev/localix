import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { docPages, loadDocContent } from '../generated/docs'
import { Button } from '@localixai/kit/button'
import { ButtonLink } from '../components/Button'
import { PAGE_SHELL } from '../lib/shell'
import { DocsShell } from './docs/DocsShell'
import { DocsSkeleton } from './docs/DocsSkeleton'
import { LazyDocsArticle } from './docs/loadDocsArticle'
import { useDocMetadata } from './docs/useDocMetadata'
import type { DocBootstrap, DocHeading } from './docs/docBootstrap'

function scrollDocumentToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

export function DocsPage({ initialDoc }: { initialDoc?: DocBootstrap }) {
  const { slug } = useParams()
  const location = useLocation()
  const active = docPages.find((page) => page.slug === slug)
  const seed = initialDoc?.slug === slug ? initialDoc : undefined
  const [loaded, setLoaded] = useState<{ slug: string; content: string } | undefined>(seed)
  const [failed, setFailed] = useState<string>()
  // A failure belongs to the page that failed: moving to another one clears it.
  if (failed !== undefined && failed !== slug) setFailed(undefined)
  const [retry, setRetry] = useState(0)
  const [outline, setOutline] = useState<{ slug: string; headings: DocHeading[] } | undefined>(seed)
  const articleRef = useRef<HTMLElement>(null)
  const previousSlug = useRef(slug)
  const focusAfterLoad = useRef(false)
  const content = loaded && loaded.slug === slug ? loaded.content : undefined
  const headings = outline && outline.slug === slug ? outline.headings : []

  useEffect(() => {
    if (!active || loaded?.slug === active.slug) return
    let current = true
    void loadDocContent(active.slug).then(
      (content) => {
        if (current) setLoaded({ slug: active.slug, content })
      },
      () => {
        if (current) setFailed(active.slug)
      },
    )
    return () => {
      current = false
    }
  }, [active, loaded?.slug, retry])

  useEffect(() => {
    if (previousSlug.current === slug) return
    previousSlug.current = slug
    focusAfterLoad.current = true
    scrollDocumentToTop()
  }, [slug])

  const onHeadings = useCallback(
    (headings: DocHeading[]) => {
      if (slug) setOutline({ slug, headings })
    },
    [slug],
  )

  useEffect(() => {
    if (outline?.slug !== slug) return
    const targetId = location.hash.slice(1)
    if (targetId) {
      const target = document.getElementById(decodeURIComponent(targetId))
      if (!target) return
      target.scrollIntoView({ block: 'start', behavior: 'instant' })
      target.focus({ preventScroll: true })
      focusAfterLoad.current = false
    } else if (focusAfterLoad.current) {
      focusAfterLoad.current = false
      articleRef.current?.focus({ preventScroll: true })
      scrollDocumentToTop()
      const frame = window.requestAnimationFrame(scrollDocumentToTop)
      return () => window.cancelAnimationFrame(frame)
    }
  }, [outline, slug, location.hash])

  useDocMetadata(active)
  if (!active)
    return (
      <div className={`${PAGE_SHELL} py-24`}>
        <h1 className="font-heading text-3xl">Documentation page not found</h1>
        <ButtonLink to="/docs" variant="outline" className="mt-6">
          Browse docs
        </ButtonLink>
      </div>
    )
  const fallback =
    seed && content === seed.content ? (
      <div dangerouslySetInnerHTML={{ __html: seed.html }} />
    ) : (
      <DocsSkeleton />
    )
  return (
    <DocsShell
      active={active}
      headings={headings}
      loading={content === undefined && failed !== slug}
      articleRef={articleRef}
    >
      {failed === slug ? (
        <div className="py-12" role="alert">
          <p>Could not load this page.</p>
          <Button
            variant="ghost"
            className="mt-3"
            onClick={() => {
              setFailed(undefined)
              setRetry((value) => value + 1)
            }}
          >
            Try again
          </Button>
        </div>
      ) : content === undefined ? (
        fallback
      ) : (
        <Suspense fallback={fallback}>
          <LazyDocsArticle
            key={slug}
            content={content}
            sourcePath={active.sourcePath}
            onHeadings={onHeadings}
          />
        </Suspense>
      )}
    </DocsShell>
  )
}
