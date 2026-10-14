import { Link, useLocation, useNavigate } from 'react-router'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { BreadcrumbSelect } from '@localixai/kit/breadcrumb-select'
import { docPages, type DocPage } from '@/generated/docs'
import { featureCategoryFor, groupByCategory, groupBySection } from './docGroups'

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
  const sectionPages = docPages.filter((page) => page.section === active.section)
  const pageItems = (pages: DocPage[]) =>
    pages.map((page) => ({
      id: page.slug,
      label: page.title,
      active: page.slug === active.slug,
      onSelect: () => void navigate(`/docs/${page.slug}`),
    }))
  const sections = groupBySection(docPages).map((section) => ({
    id: section.pages[0]!.section,
    label: section.title,
    active: section.pages[0]!.section === active.section,
    onSelect: () => void navigate(`/docs/${section.pages[0]!.slug}`),
  }))
  const siblings = category
    ? sectionPages.filter((page) => featureCategoryFor(page) === category)
    : sectionPages
  const categories = groupByCategory(sectionPages).map((group) => ({
    id: group.title,
    label: group.title,
    active: group.title === category,
    onSelect: () => void navigate(`/docs/${group.pages[0]!.slug}`),
  }))

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
            <BreadcrumbSelect
              label="Home"
              ariaLabel="Browse site"
              items={[
                { id: 'home', label: 'Home', onSelect: () => void navigate('/') },
                { id: 'docs', label: 'Docs', active: true, onSelect: () => void navigate('/docs') },
              ]}
            />
          </li>
          <Separator />
          <li>
            <BreadcrumbSelect
              label="Docs"
              ariaLabel="Browse documentation sections"
              items={sections}
            />
          </li>
          <Separator />
          <li>
            <BreadcrumbSelect
              label={active.sectionTitle}
              ariaLabel="Browse section"
              items={category ? categories : pageItems(sectionPages)}
              searchPlaceholder="Filter pages…"
            />
          </li>
          {category && (
            <>
              <Separator />
              <li>
                <BreadcrumbSelect
                  label={category}
                  ariaLabel="Browse category"
                  items={pageItems(siblings)}
                  searchPlaceholder="Filter pages…"
                />
              </li>
            </>
          )}
          <Separator />
          <li aria-current="page" className="text-text-soft">
            <BreadcrumbSelect
              label={active.title}
              ariaLabel="Browse sibling pages"
              ariaCurrent="page"
              items={pageItems(siblings)}
              searchPlaceholder="Filter pages…"
            />
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
  editLink,
}: {
  previous: DocPage | null
  next: DocPage | null
  editLink?: ReactNode
}) {
  if (!previous && !next && !editLink) return null

  return (
    <nav aria-label="Documentation pagination" className="docs-pagination">
      {previous ? (
        <Link
          to={`/docs/${previous.slug}`}
          aria-label={`Previous article: ${previous.title}`}
          title={previous.title}
          className="docs-pagination-link focus-ring"
        >
          <span aria-hidden="true" className="text-text-faint">
            ←
          </span>
        </Link>
      ) : null}
      {editLink}
      {next && (
        <Link
          to={`/docs/${next.slug}`}
          aria-label={`Next article: ${next.title}`}
          title={next.title}
          className="docs-pagination-link docs-pagination-next focus-ring"
        >
          <span aria-hidden="true" className="text-text-faint">
            →
          </span>
        </Link>
      )}
    </nav>
  )
}
