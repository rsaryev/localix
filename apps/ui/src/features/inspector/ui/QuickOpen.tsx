import { useEffect, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { useDebouncedQuery } from '@/shared/hooks/useDebouncedQuery'
import { fileIcon } from '@/shared/ui/file-icon/fileIcon'
import { MatchedText } from '@localixai/kit/matched-text'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@localixai/kit/command'
import { CommandHints } from '@/shared/ui/command-hints'
import { baseName, dirName } from '@localixai/plugin-sdk/ui/utilities'
import type { FileSearchEntry } from '@/shared/api/contracts'
import { openFileInGrid, useRecentFiles } from '@/shared/lib/recentFiles'
import { loadFileEditor } from '../model/fileEditorLoader'
import { subscribeUiOverlay } from '@/shared/lib/uiOverlayBus'
import { QUICK_OPEN_OVERLAY_ID } from './QuickOpen.surface'

interface QuickOpenProps {
  sessionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * ⌘P / Ctrl+P go-to-file palette. Fuzzy-searches project files server-side
 * (`rg --files` + ranked match) and opens the pick in the inspector. Reuses the
 * shared cmdk Command primitive; filtering is server-side so `shouldFilter` is
 * off. Resets its query each time it opens.
 */
export function QuickOpen({ sessionId, open, onOpenChange }: QuickOpenProps) {
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<FileSearchEntry[]>([])
  const [root, setRoot] = useState('')
  /** How many project files the server left out of its index (huge tree). */
  const [indexTruncated, setIndexTruncated] = useState(0)
  const [loading, setLoading] = useState(false)
  const [resultKey, setResultKey] = useState<string | null>(null)
  const recentFiles = useRecentFiles(sessionId)
  const trimmed = query.trim()
  // "name:line" suffix — search by the name part, jump to the line
  // on open. Accepts a trailing ":col" too (so a pasted `foo.ts:42:10` from
  // compiler output works); the column is ignored. Only the all-digit tail is
  // split off, so names with stray colons are left intact.
  const colon = /^(.*?):(\d+)(?::\d+)?$/.exec(trimmed)
  const searchPart = colon ? colon[1] : trimmed
  const gotoLine = colon ? Number(colon[2]) : undefined
  const searchKey = JSON.stringify([sessionId, searchPart])
  const requestedQuery = useRef<string | null>(null)

  // ⌘P is explicit file-open intent. Start the same lazy promise React.lazy consumes
  // while the user searches, so FileTab and Monaco do not begin only after selection.
  useEffect(() => {
    if (open && sessionId) void loadFileEditor()
  }, [open, sessionId])

  useEffect(
    () =>
      subscribeUiOverlay(QUICK_OPEN_OVERLAY_ID, (params) => {
        const query = typeof params.query === 'string' ? params.query : ''
        requestedQuery.current = query
        if (open) {
          setQuery(query)
          requestedQuery.current = null
        }
        onOpenChange(true)
      }),
    [onOpenChange, open],
  )

  // Reset on open so a stale prior query/result never flashes.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when the palette opens
      setQuery(requestedQuery.current ?? '')
      requestedQuery.current = null
      setFiles([])
    }
  }, [open])

  // Debounced server search — only with a query. The empty state lists recently
  // opened files (below), so no round-trip is needed before the user types.
  useDebouncedQuery([searchPart, open, sessionId, searchKey], 90, {
    run:
      open && sessionId && searchPart
        ? () => backendClient.searchFiles(sessionId, searchPart, { limit: 40, type: 'files' })
        : null,
    onIdle: () => {
      setFiles([])
      setRoot('')
      setResultKey(null)
      setIndexTruncated(0)
      setLoading(false)
    },
    onStart: () => setLoading(true),
    onResult: (res) => {
      setRoot(res.root)
      setFiles(res.files)
      setIndexTruncated(res.indexTruncated ?? 0)
      setResultKey(searchKey)
    },
    onError: () => setFiles([]),
    onSettled: () => setLoading(false),
  })

  // Effects clear stale state after a prop/query change; this ownership check also
  // prevents a one-paint window where an old workspace result could still be picked.
  const visibleFiles = resultKey === searchKey ? files : []
  const visibleRoot = resultKey === searchKey ? root : ''

  const pick = (rel: string) => {
    if (sessionId)
      openFileInGrid({
        sessionId,
        path: visibleRoot ? `${visibleRoot}/${rel}` : rel,
        ...(gotoLine !== undefined ? { line: gotoLine } : {}),
      })
    onOpenChange(false)
  }
  // Recents are stored as absolute paths, so they open directly.
  const pickRecent = (path: string) => {
    if (sessionId) openFileInGrid({ sessionId, path })
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to file"
      description="Fuzzy-search project files and open one"
    >
      <Command shouldFilter={false}>
        <CommandInput placeholder="Go to file…" value={query} onValueChange={setQuery} />
        <CommandList>
          {loading && visibleFiles.length === 0 ? (
            <ActivitySignal
              label="Searching"
              className="justify-center py-6 text-xs text-text-faint"
              labelClassName="min-w-0"
            />
          ) : (
            <CommandEmpty>
              {!sessionId
                ? 'Open a session to search files.'
                : trimmed
                  ? 'No matching files.'
                  : 'Type to search · recent files below'}
            </CommandEmpty>
          )}
          {/* Empty query → recently opened files (newest first). */}
          {!trimmed && recentFiles.length > 0 && (
            <CommandGroup heading="Recently opened">
              {recentFiles.map((path) => {
                const { Icon, color } = fileIcon(baseName(path))
                const dir = dirName(path)
                return (
                  <CommandItem
                    key={path}
                    value={path}
                    onSelect={() => pickRecent(path)}
                    className="gap-2"
                  >
                    <Icon className={`size-4 shrink-0 ${color}`} />
                    <span className="truncate text-foreground">{baseName(path)}</span>
                    {dir && (
                      <span className="ml-auto truncate pl-3 text-2xs text-text-faint">{dir}</span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}
          {visibleFiles.map((entry) => {
            const rel = entry.path
            const { Icon, color } = fileIcon(entry.name)
            const dir = dirName(rel)
            return (
              <CommandItem key={rel} value={rel} onSelect={() => pick(rel)} className="gap-2">
                <Icon className={`size-4 shrink-0 ${color}`} />
                <MatchedText text={entry.name} query={searchPart} />
                {dir && (
                  <span className="ml-auto truncate pl-3 text-2xs text-text-faint">{dir}</span>
                )}
              </CommandItem>
            )
          })}
          {/* A capped index must say so: without this, a file missing because the
              tree is enormous looks exactly like a file that does not exist. */}
          {indexTruncated > 0 && resultKey === searchKey && (
            <div className="border-t border-border-soft px-3 py-2 text-2xs text-text-faint">
              Project too large to index fully — {indexTruncated.toLocaleString()} files are not
              searchable here.
            </div>
          )}
        </CommandList>
        <CommandHints active="files" />
      </Command>
    </CommandDialog>
  )
}
