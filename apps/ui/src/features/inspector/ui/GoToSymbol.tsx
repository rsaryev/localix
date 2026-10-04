import { useEffect, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import type { LspDocumentSymbol } from '@/shared/api/contracts'
import { MatchedText } from '@localixai/kit/matched-text'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@localixai/kit/command'
import { CommandHints } from '@/shared/ui/command-hints'
import { baseName } from '@localixai/plugin-sdk/ui/utilities'
import { openFileInGrid, useActiveFilePath } from '../model/fileNav'
import { symbolKindMeta } from '../model/symbolKindMeta'
import { subscribeUiOverlay } from '@/shared/lib/uiOverlayBus'
import { DOCUMENT_SYMBOL_OVERLAY_ID } from './GoToSymbol.surface'

interface GoToSymbolProps {
  sessionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * ⌘⇧O / Ctrl+Shift+O go-to-symbol palette. Lists the document symbols (outline)
 * of the file currently open in the inspector editor — fetched live via the LSP
 * `documentSymbol` request — and jumps to the pick. cmdk filters the in-memory
 * list by name. No-op (with a hint) when no file is open.
 */
export function GoToSymbol({ sessionId, open, onOpenChange }: GoToSymbolProps) {
  // The file currently shown in the focused grid group (file or diff).
  const filePath = useActiveFilePath()
  const [symbols, setSymbols] = useState<LspDocumentSymbol[]>([])
  const [resultKey, setResultKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Tracked so symbol names can highlight the matched characters (cmdk still
  // owns the actual filtering by item value).
  const [query, setQuery] = useState('')
  const requestedQuery = useRef<string | null>(null)

  useEffect(
    () =>
      subscribeUiOverlay(DOCUMENT_SYMBOL_OVERLAY_ID, (params) => {
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

  // Reset the query each time the palette opens so a stale search never lingers.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when the palette opens
    if (open) {
      setQuery(requestedQuery.current ?? '')
      requestedQuery.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open || !sessionId || !filePath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear when closed / no file open
      setSymbols([])
      setResultKey(null)
      setLoading(false)
      return
    }
    let cancelled = false
    // Drop the previous file's outline up front so switching files shows the
    // spinner rather than briefly filtering the wrong file's symbols.
    setSymbols([])
    setResultKey(null)
    setLoading(true)
    void backendClient
      .lspDocumentSymbols(sessionId, filePath)
      .then((res) => {
        if (!cancelled) {
          setSymbols(res)
          setResultKey(JSON.stringify([sessionId, filePath]))
        }
      })
      .catch(() => {
        if (!cancelled) setSymbols([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, sessionId, filePath])

  const pick = (s: LspDocumentSymbol) => {
    if (sessionId && filePath)
      openFileInGrid({ sessionId, path: filePath, line: s.line + 1, column: s.character })
    onOpenChange(false)
  }
  const currentKey = JSON.stringify([sessionId, filePath])
  const visibleSymbols = resultKey === currentKey ? symbols : []

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to symbol"
      description="Jump to a symbol in the current file"
    >
      <Command>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={filePath ? `Go to symbol in ${baseName(filePath)}…` : 'Go to symbol…'}
        />
        <CommandList>
          {loading && visibleSymbols.length === 0 ? (
            <ActivitySignal
              label="Loading symbols"
              className="justify-center py-6 text-xs text-text-faint"
              labelClassName="min-w-0"
            />
          ) : (
            <CommandEmpty>
              {filePath ? 'No symbols in this file.' : 'Open a file to list its symbols.'}
            </CommandEmpty>
          )}
          {visibleSymbols.map((s, i) => {
            const { Icon, label } = symbolKindMeta(s.kind)
            return (
              <CommandItem
                key={`${s.line}:${s.character}:${s.kind}:${s.name}`}
                value={`${s.name} ${i}`}
                onSelect={() => pick(s)}
                className="gap-2"
              >
                <span style={{ width: s.depth * 12 }} className="shrink-0" />
                <Icon className="size-3.5 shrink-0 text-text-faint" />
                <MatchedText text={s.name} query={query} />
                {s.detail && <span className="truncate text-2xs text-text-faint">{s.detail}</span>}
                <span className="ml-auto shrink-0 text-2xs text-text-faint">{label}</span>
              </CommandItem>
            )
          })}
        </CommandList>
        <CommandHints active="symbols" />
      </Command>
    </CommandDialog>
  )
}
