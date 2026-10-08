import { Link, useLocation, useNavigate } from 'react-router'
import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import type { DocPage } from '@/generated/docs'

const Separator = () => (
  <li aria-hidden>
    <ChevronRight className="size-3 opacity-40" />
  </li>
)

export function DocsBreadcrumb({ active, category }: { active: DocPage; category: string | null }) {
  const rail = useRef<HTMLElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const navigate = useNavigate()
  const location = useLocation()

  useLayoutEffect(() => {
    const element = rail.current
    if (!element) return
    const updateEdges = () =>
      setEdges({
        left: element.scrollLeft > 1,
        right: element.scrollWidth - element.clientWidth - element.scrollLeft > 1,
      })
    const revealCurrent = () => {
      element.scrollLeft = element.scrollWidth
      updateEdges()
    }
    revealCurrent()
    element.addEventListener('scroll', updateEdges)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(revealCurrent)
    observer?.observe(element)
    return () => {
      element.removeEventListener('scroll', updateEdges)
      observer?.disconnect()
    }
  }, [active.slug, active.title, category])

  return (
    <div className="docs-breadcrumb-row">
      <IconButton
        aria-label="Back"
        size="touch"
        className="docs-breadcrumb-back bg-transparent hover:bg-transparent"
        onClick={() => {
          if (location.key === 'default') void navigate('/docs')
          else void navigate(-1)
        }}
      >
        <ArrowLeft className="size-4" />
      </IconButton>
      <nav
        ref={rail}
        aria-label="Breadcrumb"
        data-fade-left={edges.left}
        data-fade-right={edges.right}
        className="docs-breadcrumb text-sm text-text-faint"
      >
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/" className="focus-ring hover:text-foreground">
              Home
            </Link>
          </li>
          <Separator />
          <li>
            <Link to="/docs" className="focus-ring hover:text-foreground">
              Docs
            </Link>
          </li>
          <Separator />
          <li>{active.sectionTitle}</li>
          {category && (
            <>
              <Separator />
              <li>{category}</li>
            </>
          )}
          <Separator />
          <li aria-current="page" className="text-text-soft">
            {active.title}
          </li>
        </ol>
      </nav>
    </div>
  )
}

/** Sequential movement through the flat page order the docs tree was built from. */
export function DocsPagination({
  previous,
  next,
}: {
  previous: DocPage | null
  next: DocPage | null
}) {
  if (!previous && !next) return null

  return (
    <nav aria-label="Documentation pagination" className="docs-pagination">
      {previous ? (
        <Link
          to={`/docs/${previous.slug}`}
          aria-label={`Previous article: ${previous.title}`}
          className="docs-pagination-link focus-ring"
        >
          <span aria-hidden="true" className="text-text-faint">
            ←
          </span>
          <span>{previous.title}</span>
        </Link>
      ) : null}
      {next && (
        <Link
          to={`/docs/${next.slug}`}
          aria-label={`Next article: ${next.title}`}
          className="docs-pagination-link docs-pagination-next focus-ring"
        >
          <span>{next.title}</span>
          <span aria-hidden="true" className="text-text-faint">
            →
          </span>
        </Link>
      )}
    </nav>
  )
}
