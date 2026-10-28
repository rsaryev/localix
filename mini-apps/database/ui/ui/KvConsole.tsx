import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import { ResultCountStatus } from '@localixai/mini-app-sdk/ui/result-count-status'
import {
  Autocomplete,
  AutocompleteAnchor,
  AutocompleteList,
  AutocompleteOption,
} from '@localixai/kit/autocomplete'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { DocHistoryPopover } from './doc-console/DocHistoryPopover'
import { SqlResultsView } from './SqlResultsView'
import { matchRedisCommands } from '../model/redisCommands'
import type { SqlConsoleState } from '../model/useSqlConsole'
import type { useSqlHistory } from '../model/useSqlHistory'
import { Input } from '@localixai/kit/input'
import { RunButton, StopButton } from './consoleActions'

export function KvCommandInput({
  value,
  onValueChange,
  onRun,
}: {
  value: string
  onValueChange: (value: string) => void
  onRun: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = `${useId()}-redis-commands`
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const suggestions = useMemo(() => matchRedisCommands(value), [value])
  const open = suggestions.length > 0 && !dismissed
  // A value can also change through history/session restoration, outside this
  // input's onChange path. Keep aria-activedescendant on an existing option
  // even when that external update shortens the result set.
  const activeIndex = Math.min(selectedIndex, Math.max(suggestions.length - 1, 0))
  const activeOptionId = open ? `${listId}-option-${activeIndex}` : undefined

  // The `autoFocus` attribute, done by hand: the command field takes focus when it appears.
  useLayoutEffect(() => {
    inputRef.current?.focus()
  }, [])

  const accept = (name: string) => {
    onValueChange(`${name} `)
    setDismissed(true)
    inputRef.current?.focus()
  }

  return (
    <Autocomplete
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setDismissed(true)
      }}
    >
      <AutocompleteAnchor asChild>
        <Input
          ref={inputRef}
          aria-label="Redis command"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activeOptionId}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value)
            setDismissed(false)
            setSelectedIndex(0)
          }}
          onKeyDown={(event) => {
            if (open) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelectedIndex((activeIndex + 1) % suggestions.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelectedIndex((activeIndex - 1 + suggestions.length) % suggestions.length)
                return
              }
              if (
                event.key === 'Tab' ||
                (event.key === 'Enter' &&
                  suggestions[activeIndex] &&
                  value.trim().toUpperCase() !== suggestions[activeIndex].name)
              ) {
                event.preventDefault()
                accept(suggestions[activeIndex]!.name)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDismissed(true)
                return
              }
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              onRun()
            }
          }}
          placeholder="Redis command — e.g.  GET user:1   ·   KEYS *   ·   HGETALL cart:42"
          spellCheck={false}
          // No fill or radius override: Input already carries the `--input` veil and the scale's
          // 28px radius, and `bg-surface-raised` mixes from a darker ground than the console pane,
          // so the command field read as black.
          className="h-7 w-full border-border px-2 py-1 font-mono text-xs"
        />
      </AutocompleteAnchor>
      {open && (
        <>
          <ResultCountStatus count={suggestions.length} singular="command" plural="commands" />
          <AutocompleteList id={listId} aria-label="Redis command suggestions" className="w-96">
            {suggestions.map((command, index) => (
              <AutocompleteOption
                key={command.name}
                id={`${listId}-option-${index}`}
                active={index === activeIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => accept(command.name)}
                className="flex-col items-start gap-0.5"
              >
                <span className="font-mono text-2xs text-foreground">{command.syntax}</span>
                <span className="text-2xs text-text-faint">{command.summary}</span>
              </AutocompleteOption>
            ))}
          </AutocompleteList>
        </>
      )}
    </Autocomplete>
  )
}

/**
 * Redis (kv) command console — the non-SQL sibling of {@link SqlConsole}. A single command
 * bar (no SQL editor, EXPLAIN, Format, or row editing) runs one Redis command and renders the
 * reply in the shared results grid, with verb autocomplete while typing the command name.
 * Reuses the connection's run lifecycle + the same history popover.
 */
export function KvConsole({
  console: c,
  connectionId,
  dbLabel,
  history,
}: {
  console: SqlConsoleState
  connectionId: string
  /** The tab's own title — the identity a failed command is filed under. */
  dbLabel?: string
  history: ReturnType<typeof useSqlHistory>
}) {
  const run = () => void c.run()

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Command bar */}
      <WorkbenchToolbar aria-label="Redis command controls" className="gap-1.5 px-2">
        <TerminalSquare className="size-3.5 shrink-0 text-text-faint" />
        <div className="min-w-0 flex-1">
          <KvCommandInput value={c.sql} onValueChange={c.setSql} onRun={run} />
        </div>
        <DocHistoryPopover
          history={history}
          historyLabel="Recent commands"
          triggerTitle="Command history"
          onPick={c.setSql}
        />
        {c.running ? (
          <StopButton onClick={c.cancel} title="Stop the running command" />
        ) : (
          <RunButton
            running={false}
            onClick={run}
            disabled={!c.sql.trim()}
            title="Run command (Enter)"
          />
        )}
      </WorkbenchToolbar>

      {/* Results (read-only — no editing on a command reply) */}
      <div className="min-h-0 flex-1">
        <SqlResultsView
          subject={`${dbLabel ?? connectionId} console`}
          error={c.error}
          errorCode={c.errorCode}
          outcome={c.outcome}
          rows={c.sortedRows}
          sort={c.sort}
          toggleSort={c.toggleSort}
          filter={c.filter}
          onFilterChange={c.setFilter}
          total={c.totalRows}
          emptyHint="Run a Redis command to see the reply."
        />
      </div>
    </div>
  )
}
