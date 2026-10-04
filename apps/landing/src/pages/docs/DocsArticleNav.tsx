import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import type { DocPage } from '@/generated/docs'

const Separator = () => (
  <li aria-hidden>
    <ChevronRight className="size-3 opacity-40" />
  </li>
)

export function DocsBreadcrumb({ active, category }: { active: DocPage; category: string | null }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 text-xs text-text-faint">
      <ol className="flex flex-wrap items-center gap-2">
        <li>
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
        </li>
        <Separator />
        <li>
          <Link to="/docs" className="hover:text-foreground">
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
    <nav
      aria-label="Documentation pagination"
      className="mt-12 grid gap-3 border-t border-border-subtle pt-6 sm:grid-cols-2"
    >
      {previous ? (
        <Link
          to={`/docs/${previous.slug}`}
          className="rounded-xl border border-border-subtle p-4 transition-colors hover:border-control-border-hover"
        >
          <span className="text-xs text-text-faint">← Previous</span>
          <div className="mt-0.5 text-sm font-medium text-foreground">{previous.title}</div>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link
          to={`/docs/${next.slug}`}
          className="rounded-xl border border-border-subtle p-4 text-right transition-colors hover:border-control-border-hover sm:col-start-2"
        >
          <span className="text-xs text-text-faint">Next →</span>
          <div className="mt-0.5 text-sm font-medium text-foreground">{next.title}</div>
        </Link>
      )}
    </nav>
  )
}
