import { Link, useLocation } from 'react-router'
import { PAGE_SHELL } from '../lib/shell'
import { GitHubMark } from './GitHubMark'
import { preloadDocsArticle } from '../pages/docs/loadDocsArticle'
import { docPages, loadDocContent } from '../generated/docs'
import { DocsSearch } from '../pages/docs/DocsSearch'

function warmDocs() {
  void preloadDocsArticle().catch(() => {})
  if (docPages[0]) void loadDocContent(docPages[0].slug).catch(() => {})
}

export function SiteHeader() {
  const docs = useLocation().pathname.startsWith('/docs')
  return (
    <header className="site-header">
      <div className={`${PAGE_SHELL} flex h-16 items-center justify-end gap-4`}>
        <nav aria-label="Site navigation" className="flex items-center gap-2 text-sm md:gap-5">
          {docs && <DocsSearch />}
          <Link
            to="/docs"
            aria-current={docs ? 'page' : undefined}
            onPointerEnter={warmDocs}
            onFocus={warmDocs}
            className={`site-header-link focus-ring ${docs ? 'text-foreground' : 'text-text-soft hover:text-foreground'}`}
          >
            Docs
          </Link>
          <a
            href="https://github.com/rsaryev/localix"
            target="_blank"
            rel="noreferrer"
            aria-label="Localix on GitHub"
            className="site-header-link focus-ring text-text-soft hover:text-foreground"
          >
            <GitHubMark className="size-4" />
          </a>
        </nav>
      </div>
    </header>
  )
}
