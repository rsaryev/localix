import { useState, type ReactNode, type Ref } from 'react'
import { docPages, type DocPage } from '../../generated/docs'
import { PAGE_SHELL } from '../../lib/shell'
import { DocsSidebar } from './DocsSidebar'
import { DocsMobilePicker } from './DocsMobilePicker'
import { DocsBreadcrumb, DocsPagination } from './DocsArticleNav'
import { DocsTableOfContents } from './DocsTableOfContents'
import { DocsReadingTools, type ReadingSize } from './DocsReadingTools'
import { featureCategoryFor } from './docGroups'
import { useDocSearch } from './useDocSearch'
import type { DocHeading } from './docBootstrap'
import { Skeleton } from '@localixai/kit/skeleton'

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
  const search = useDocSearch()
  const [size, setSize] = useState<ReadingSize>('standard')
  const [focus, setFocus] = useState(false)
  const index = docPages.findIndex((page) => page.slug === active.slug)
  return (
    <div
      className={`${PAGE_SHELL} docs-layout ${focus ? 'docs-focus' : ''}`}
      data-reader-size={size}
    >
      <DocsSidebar active={active} search={search} />
      <article
        id="doc-content"
        ref={articleRef}
        tabIndex={-1}
        className="docs-article min-w-0 outline-none"
      >
        <DocsMobilePicker active={active} search={search} />
        <div className="docs-reading-bar">
          <DocsBreadcrumb
            active={active}
            category={active.section === 'features' ? featureCategoryFor(active) : null}
          />
          <DocsReadingTools
            size={size}
            onSize={setSize}
            focus={focus}
            onFocus={() => setFocus((value) => !value)}
          />
        </div>
        <div
          id="doc-body"
          className="markdown-renderer docs-prose"
          aria-busy={loading || undefined}
        >
          {children}
        </div>
        <DocsPagination
          previous={index > 0 ? docPages[index - 1] : null}
          next={index >= 0 && index < docPages.length - 1 ? docPages[index + 1] : null}
        />
        <a
          href={`https://github.com/rsaryev/localix/blob/main/${active.sourcePath}`}
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-block text-xs text-text-faint hover:text-foreground"
        >
          Edit this page on GitHub
        </a>
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
