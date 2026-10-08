import { Link, useLocation } from 'react-router'
import { PAGE_SHELL } from '../lib/shell'
import { RELEASE_CHANNEL } from './releaseChannel'
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
      <div className={`${PAGE_SHELL} flex h-16 items-center justify-between gap-4`}>
        <Link
          to="/"
          className="flex items-center gap-2.5 text-sm font-medium"
          aria-label="Localix home"
        >
          <img src="/logo.svg" alt="" className="size-5" />
          Localix <span className="text-xs font-normal text-text-faint">{RELEASE_CHANNEL}</span>
        </Link>
        <nav aria-label="Site navigation" className="flex items-center gap-5 text-sm">
          {docs && <DocsSearch />}
          <Link
            to="/docs"
            aria-current={docs ? 'page' : undefined}
            onPointerEnter={warmDocs}
            onFocus={warmDocs}
            className={docs ? 'text-foreground' : 'text-text-soft hover:text-foreground'}
          >
            Docs
          </Link>
          <a
            href="https://github.com/rsaryev/localix"
            target="_blank"
            rel="noreferrer"
            aria-label="Localix on GitHub"
            className="text-text-soft hover:text-foreground"
          >
            <GitHubMark className="size-4" />
          </a>
        </nav>
      </div>
    </header>
  )
}
