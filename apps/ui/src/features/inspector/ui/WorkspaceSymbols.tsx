import { useEffect, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { useDebouncedQuery } from '@/shared/hooks/useDebouncedQuery'
import { Spinner } from '@localixai/kit/spinner'
import type { WorkspaceSymbol } from '@/shared/api/contracts'
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
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import { openFileInGrid } from '@/shared/lib/recentFiles'
import { loadFileEditor } from '../model/fileEditorLoader'
import { symbolKindMeta } from '../model/symbolKindMeta'
import { WORKSPACE_SYMBOL_OVERLAY_ID } from './WorkspaceSymbols.surface'
import { useOverlayPaletteQuery } from './useOverlayPaletteQuery'

interface WorkspaceSymbolsProps {
  sessionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * ⌘T / Ctrl+T workspace-symbol palette ("Go to Symbol in Workspace").
 * Unlike the per-file GoToSymbol (⌘⇧O), this queries the LSP `workspace/symbol`
 * request across every running language server for the project — so it finds
 * symbols in files that aren't open. Server-side filtering by the typed query
 * (debounced); jumps to the pick across files.
 */
export function WorkspaceSymbols({ sessionId, open, onOpenChange }: WorkspaceSymbolsProps) {
  const [query, setQuery] = useOverlayPaletteQuery(WORKSPACE_SYMBOL_OVERLAY_ID, open, onOpenChange)
  const [symbols, setSymbols] = useState<WorkspaceSymbol[]>([])
  const [loading, setLoading] = useState(false)
  const [resultKey, setResultKey] = useState<string | null>(null)

  // ⌘T is explicit cross-file navigation intent. Warm the editor graph while the
  // language server searches instead of waiting for the selected symbol to render.
  useEffect(() => {
    if (open && sessionId) void loadFileEditor()
  }, [open, sessionId])

  // Each opening starts from fresh results as well as a fresh query.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when the palette opens
    if (open) setSymbols([])
  }, [open])

  // workspace/symbol is server-side filtering — re-query (debounced) as the user types.
  const trimmedQuery = query.trim()
  const symbolKey = JSON.stringify([sessionId, trimmedQuery])
  useDebouncedQuery([open, sessionId, query], 200, {
    run:
      open && sessionId && trimmedQuery
        ? () => backendClient.lspWorkspaceSymbols(sessionId, trimmedQuery)
        : null,
    onIdle: () => {
      setSymbols([])
      setResultKey(null)
      setLoading(false)
    },
    onStart: () => setLoading(true),
    onResult: (res) => {
      setSymbols(res)
      setResultKey(symbolKey)
    },
    onError: () => setSymbols([]),
    onSettled: () => setLoading(false),
  })

  const pick = (s: WorkspaceSymbol) => {
    if (sessionId)
      openFileInGrid({ sessionId, path: s.file, line: s.line + 1, column: s.character })
    onOpenChange(false)
  }

  // Clearing results when the query empties is a pure DERIVATION (an empty query
  // never has matches), so the effect no longer has to setState to reset them.
  const trimmed = query.trim()
  const currentKey = JSON.stringify([sessionId, trimmed])
  const visibleSymbols = trimmed && resultKey === currentKey ? symbols : []
  const busy = trimmed ? loading : false

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to symbol in workspace"
      description="Search symbols across the whole project"
    >
      {/* shouldFilter=false: the language server already filtered by the query;
          cmdk must not re-filter the cross-file results by item value. */}
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Go to symbol in workspace…"
        />
        <CommandList>
          {busy && visibleSymbols.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-text-faint">
              <Spinner size="sm" /> Searching symbols…
            </div>
          ) : (
            <CommandEmpty>
              {trimmed ? 'No symbols match.' : 'Type to search project symbols.'}
            </CommandEmpty>
          )}
          {visibleSymbols.map((s, i) => {
            const { Icon, label } = symbolKindMeta(s.kind)
            return (
              <CommandItem
                key={`${s.file}:${s.line}:${s.character}`}
                value={`${s.name} ${i}`}
                onSelect={() => pick(s)}
                className="gap-2"
              >
                <Icon className="size-3.5 shrink-0 text-text-faint" />
                <MatchedText text={s.name} query={query} />
                {s.containerName && (
                  <span className="truncate text-2xs text-text-faint">{s.containerName}</span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-2 text-2xs text-text-faint">
                  <span className="truncate">{baseName(s.file)}</span>
                  <span>{label}</span>
                </span>
              </CommandItem>
            )
          })}
        </CommandList>
        <CommandHints active="workspace-symbols" />
      </Command>
    </CommandDialog>
  )
}
