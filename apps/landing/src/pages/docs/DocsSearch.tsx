import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import { Search, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { SearchInput } from '@localixai/kit/search-input'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@localixai/kit/dialog'
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@localixai/kit/drawer'
import { useDocSearch } from './useDocSearch'
import './docs-search.css'

function subscribe(listener: () => void) {
  const media = window.matchMedia('(max-width: 767px)')
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

export function DocsSearch() {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLDivElement>(null)
  const selected = useRef(false)
  const navigate = useNavigate()
  const mobile = useSyncExternalStore(
    subscribe,
    () => window.matchMedia('(max-width: 767px)').matches,
    () => false,
  )
  const search = useDocSearch()
  const setQuery = search.setQuery
  const [viewport, setViewport] = useState<{ height: number; bottom: number } | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        selected.current = false
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open, setQuery])

  useEffect(() => {
    if (!open || !mobile || !window.visualViewport) return
    const visual = window.visualViewport
    const update = () =>
      setViewport({
        height: visual.height,
        bottom: Math.max(0, window.innerHeight - visual.height - visual.offsetTop),
      })
    update()
    visual.addEventListener('resize', update)
    visual.addEventListener('scroll', update)
    return () => {
      visual.removeEventListener('resize', update)
      visual.removeEventListener('scroll', update)
    }
  }, [open, mobile])

  const Title = mobile ? DrawerTitle : DialogTitle
  const Description = mobile ? DrawerDescription : DialogDescription
  const settled = search.loadedContent !== null || search.failed
  const content = (
    <>
      <div className="docs-search-heading">
        <div>
          <Title>Search documentation</Title>
          <Description>Find guides, features, and reference pages.</Description>
        </div>
        <IconButton aria-label="Close search" size="xl" onClick={() => setOpen(false)}>
          <X />
        </IconButton>
      </div>
      <div ref={field} className="docs-search-field">
        <SearchInput
          aria-label="Search docs"
          placeholder="Search docs…"
          value={search.query}
          onValueChange={setQuery}
          size="xl"
        />
      </div>
      <div className="docs-search-results" aria-label="Search results">
        {!search.normalizedQuery ? (
          <div className="docs-search-empty">
            <Search aria-hidden="true" className="docs-search-empty-icon" />
            <p className="font-medium">Search the documentation</p>
          </div>
        ) : search.filtered.length ? (
          <ul>
            {search.filtered.map((page) => (
              <li key={page.slug}>
                <Button
                  variant="ghost"
                  className="docs-search-result"
                  onClick={() => {
                    selected.current = true
                    setOpen(false)
                    navigate(`/docs/${page.slug}`)
                  }}
                >
                  <span className="text-xs text-text-faint">{page.sectionTitle}</span>
                  <span className="text-base font-medium">{page.title}</span>
                  <span className="text-sm text-text-soft">{page.summary}</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="docs-search-empty" role="status">
            <p className="font-medium">{settled ? 'No matching pages' : 'Searching full text…'}</p>
            {settled && (
              <p className="text-sm text-text-soft">Try a different term or clear your search.</p>
            )}
          </div>
        )}
        {search.failed && search.normalizedQuery && (
          <p role="status" className="p-4 text-sm text-text-soft">
            Full-text search is unavailable. Titles and summaries are still searchable.
          </p>
        )}
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
      if (!selected.current) trigger.current?.focus()
      else document.querySelector<HTMLElement>('#doc-body h1')?.focus()
    },
  }

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="xl"
        aria-label="Search documentation"
        className="docs-search-trigger"
        onClick={() => {
          selected.current = false
          setOpen(true)
        }}
      >
        <Search />
        <span className="hidden md:inline">Search</span>
        <span className="hidden text-xs text-text-faint md:inline">⌘K / Ctrl K</span>
      </Button>
      {mobile ? (
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- Only focus after explicit search activation.
        <Drawer open={open} onOpenChange={setOpen} autoFocus repositionInputs={false} handleOnly>
          <DrawerContent
            className="docs-search-sheet"
            style={
              viewport
                ? {
                    height: viewport.height * 0.9,
                    bottom: viewport.bottom,
                    maxHeight: viewport.height,
                  }
                : undefined
            }
            {...focus}
          >
            {content}
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            size="2xl"
            layout="edge-to-edge"
            showCloseButton={false}
            className="docs-search-dialog"
            {...focus}
          >
            {content}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
