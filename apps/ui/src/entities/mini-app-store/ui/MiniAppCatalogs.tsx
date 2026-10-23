import { useState, type FormEvent } from 'react'
import { BookMarked, Trash2 } from 'lucide-react'
import type { MiniAppCatalogEntryRecord } from '@localixai/api/client'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { useMiniAppCatalogs } from '../model/useMiniAppCatalogs'

/** A catalog by where it lives: its host, or the folder of a `file://` one. */
function placeOf(url: string): { title: string; detail: string } {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:')
      return { title: 'A folder on this computer', detail: decodeURIComponent(parsed.pathname) }
    return { title: parsed.host, detail: url }
  } catch {
    return { title: url, detail: url }
  }
}

/**
 * The catalogs the store reads: Localix's own first, which always stays, then the ones the person
 * added, each removable, and a field to add another by its address. Adding one reads it first, so
 * an address that is not a catalog is refused under the field, with the text kept to fix.
 */
export function MiniAppCatalogsView({
  catalogs,
  onAdd,
  onRemove,
}: {
  catalogs: MiniAppCatalogEntryRecord[]
  onAdd: (url: string) => Promise<void>
  onRemove: (url: string) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim() || adding) return
    setAdding(true)
    setProblem(null)
    try {
      await onAdd(draft.trim())
      setDraft('')
    } catch (error) {
      setProblem(errorMessage(error, 'The catalog could not be added'))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {catalogs.map((catalog) => {
          const place = catalog.builtIn
            ? { title: 'Localix', detail: 'The catalog that comes with Localix' }
            : placeOf(catalog.url)
          return (
            <li
              key={catalog.url}
              className="group/catalog flex min-h-10 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover"
            >
              <BookMarked className="size-4 shrink-0 text-text-faint" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{place.title}</p>
                <p className="truncate text-xs text-text-soft" title={catalog.url}>
                  {place.detail}
                </p>
              </div>
              {catalog.builtIn ? (
                <span className="text-2xs text-text-faint">Built in</span>
              ) : (
                <IconButton
                  size="sm"
                  aria-label={`Remove ${place.title}`}
                  className="opacity-0 group-hover/catalog:opacity-100 focus-visible:opacity-100"
                  onClick={() => void onRemove(catalog.url)}
                >
                  <Trash2 />
                </IconButton>
              )}
            </li>
          )
        })}
      </ul>
      <form className="flex flex-col gap-1.5 px-2" onSubmit={(event) => void submit(event)}>
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="https://…/mini-app-catalog.json"
            aria-label="Catalog address"
            aria-invalid={problem ? true : undefined}
            className="flex-1"
          />
          <Button type="submit" size="sm" variant="field" disabled={!draft.trim() || adding}>
            {adding ? 'Adding…' : 'Add catalog'}
          </Button>
        </div>
        {problem ? (
          <p className="text-xs text-status-error">{problem}</p>
        ) : (
          <p className="text-xs text-text-faint">
            Apps from a catalog you add are marked unverified; installing one asks you first.
          </p>
        )}
      </form>
    </div>
  )
}

/** The catalogs, live: re-read on every `mini-app-catalogs` poke. */
export function MiniAppCatalogs() {
  const { catalogs, add, remove } = useMiniAppCatalogs()
  return <MiniAppCatalogsView catalogs={catalogs} onAdd={add} onRemove={remove} />
}
