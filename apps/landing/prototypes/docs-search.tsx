import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Link, Route, Routes } from 'react-router'
import { Search, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { SearchInput } from '@localixai/kit/search-input'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@localixai/kit/dialog'
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@localixai/kit/drawer'
import { DocsPage } from '../src/pages/DocsPage'
import { useDocSearch } from '../src/pages/docs/useDocSearch'
import { PAGE_SHELL } from '../src/lib/shell'
import { GitHubMark } from '../src/components/GitHubMark'
import '../src/styles.css'
import './docs-search.css'

const mediaQuery = '(max-width: 767px)'
function subscribe(listener: () => void) {
  const media = window.matchMedia(mediaQuery)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

function Prototype() {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLDivElement>(null)
  const mobile = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(mediaQuery).matches,
    () => false,
  )
  const search = useDocSearch()
  const results = search.normalizedQuery ? search.filtered : []
  const settled = search.loadedContent !== null || search.failed
  const setQuery = search.setQuery
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(!open)
        if (open) setQuery('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setQuery])
  const Title = mobile ? DrawerTitle : DialogTitle
  const Description = mobile ? DrawerDescription : DialogDescription

  function changeOpen(next: boolean) {
    setOpen(next)
    if (!next) search.setQuery('')
  }

  const content = (
    <>
      <div className="search-prototype-heading">
        <div>
          <Title>Search documentation</Title>
          <Description>Find guides, features, and reference pages.</Description>
        </div>
        <IconButton aria-label="Close search" size="xl" onClick={() => changeOpen(false)}>
          <X />
        </IconButton>
      </div>
      <div ref={field} className="search-prototype-field">
        <SearchInput
          aria-label="Search docs"
          placeholder="Search docs…"
          value={search.query}
          onValueChange={search.setQuery}
          size="xl"
        />
      </div>
      <div className="search-prototype-results" aria-label="Search results">
        {!search.normalizedQuery ? (
          <div className="search-prototype-empty">
            <p className="text-foreground">What would you like to find?</p>
            <p className="mt-2 text-sm text-text-soft">
              Try “providers”, “terminal”, or “plugins”.
            </p>
          </div>
        ) : results.length ? (
          <ul>
            {results.map((page) => (
              <li key={page.slug}>
                <Link
                  className="search-prototype-result focus-ring"
                  to={`/docs/${page.slug}`}
                  onClick={() => changeOpen(false)}
                >
                  <span className="text-xs text-text-faint">{page.sectionTitle}</span>
                  <span className="text-base font-medium text-foreground">{page.title}</span>
                  <span className="text-sm text-text-soft">{page.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="search-prototype-empty" role="status">
            <p className="text-foreground">
              {settled ? 'No matching pages' : 'Searching full text…'}
            </p>
            {settled && (
              <p className="mt-2 text-sm text-text-soft">
                Try a different term or clear your search.
              </p>
            )}
          </div>
        )}
        {search.failed && search.normalizedQuery && (
          <p role="status" className="p-4 text-sm text-text-soft">
            Full-text search is unavailable. Titles and summaries are still searchable.
          </p>
        )}
      </div>
      <div className="search-prototype-footer text-xs text-text-faint">
        Esc to close · Tab to move between results
      </div>
    </>
  )

  const focus = {
    onOpenAutoFocus: (event: Event) => {
      event.preventDefault()
      field.current?.querySelector('input')?.focus()
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault()
      trigger.current?.focus()
    },
  }

  return (
    <div
      className="prototype min-h-screen bg-background text-foreground"
      role="group"
      aria-label="Documentation search prototype"
    >
      <header className="site-header">
        <div className={`${PAGE_SHELL} flex h-16 items-center justify-between gap-4`}>
          <Link
            to="/docs/getting-started--what-is-localix"
            className="flex items-center gap-2.5 text-sm font-medium"
          >
            <img src="/logo.svg" alt="" className="size-5" />
            Localix <span className="text-xs font-normal text-text-faint">Beta</span>
          </Link>
          <nav aria-label="Site navigation" className="flex items-center gap-3 text-sm">
            <Button
              ref={trigger}
              variant="ghost"
              size="xl"
              aria-label="Search documentation"
              onClick={() => changeOpen(true)}
              className="search-prototype-trigger"
            >
              <Search />
              <span className="search-prototype-trigger-label">Search</span>
              <span className="search-prototype-trigger-label text-xs text-text-faint">
                ⌘K / Ctrl K
              </span>
            </Button>
            <Link to="/docs/getting-started--what-is-localix">Docs</Link>
            <a href="https://github.com/rsaryev/localix" aria-label="Localix on GitHub">
              <GitHubMark className="size-4" />
            </a>
          </nav>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/docs/:slug" element={<DocsPage />} />
        </Routes>
      </main>
      {mobile ? (
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- Focus is requested only after the user opens search.
        <Drawer open={open} onOpenChange={changeOpen} autoFocus>
          <DrawerContent className="search-prototype-sheet" {...focus}>
            {content}
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={changeOpen}>
          <DialogContent
            size="2xl"
            layout="edge-to-edge"
            showCloseButton={false}
            className="search-prototype-dialog"
            {...focus}
          >
            {content}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/docs/getting-started--what-is-localix']}>
    <Prototype />
  </MemoryRouter>,
)
