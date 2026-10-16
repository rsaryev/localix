import { useState, type ReactNode, type Ref } from 'react'
import { docPages, type DocPage } from '../../generated/docs'
import { PAGE_SHELL } from '../../lib/shell'
import { DocsSidebar } from './DocsSidebar'
import { DocsBreadcrumb, DocsPagination } from './DocsArticleNav'
import { DocsTableOfContents } from './DocsTableOfContents'
import { DocsReadingTools, type ReadingSize } from './DocsReadingTools'
import { featureCategoryFor } from './docGroups'
import type { DocHeading } from './docBootstrap'
import { Skeleton } from '@localixai/kit/skeleton'
import { REPOSITORY_URL } from '@/lib/site'

/** The same geometry surrounds static content, pending content and the interactive article. */
export function DocsShell({
  active,
  headings,
  loading = false,
  articleRef,
  children,
}: {
  active: DocPage
  headings: DocHeading[]
  loading?: boolean
  articleRef?: Ref<HTMLElement>
  children: ReactNode
}) {
  const [size, setSize] = useState<ReadingSize>('standard')
  const index = docPages.findIndex((page) => page.slug === active.slug)
  return (
    <div className={`${PAGE_SHELL} docs-layout`} data-reader-size={size}>
      <DocsSidebar active={active} />
      <article
        id="doc-content"
        ref={articleRef}
        tabIndex={-1}
        className="docs-article min-w-0 outline-none"
      >
        <div className="docs-reading-bar">
          <DocsBreadcrumb
            active={active}
            category={active.section === 'features' ? featureCategoryFor(active) : null}
          />
          <DocsReadingTools size={size} onSize={setSize} />
        </div>
        <div
          id="doc-body"
          className="markdown-renderer docs-prose"
          aria-busy={loading || undefined}
        >
          {children}
        </div>
        <div className="docs-bottom-bar">
          <DocsPagination
            previous={index > 0 ? docPages[index - 1] : null}
            next={index >= 0 && index < docPages.length - 1 ? docPages[index + 1] : null}
            editLink={
              <a
                href={`${REPOSITORY_URL}/blob/main/${active.sourcePath}`}
                target="_blank"
                rel="noreferrer"
                className="docs-edit-link focus-ring text-xs text-text-faint hover:text-foreground"
              >
                Edit on GitHub
              </a>
            }
          />
        </div>
      </article>
      <div className="docs-outline">
        {loading && headings.length === 0 ? (
          <div className="docs-toc sticky top-8 hidden lg:block" aria-hidden="true">
            <Skeleton className="mb-4 h-3 w-1/2" />
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className="mb-3 h-3 w-5/6" />
            ))}
          </div>
        ) : (
          <DocsTableOfContents headings={headings} />
        )}
      </div>
    </div>
  )
}
