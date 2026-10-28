import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  parseCommandArgs,
  filterArgOptions,
  type SlashArgOption,
  type ParsedCommandArgs,
} from '@localixai/api/slash-catalog'
import type { SlashCommand } from './SlashCommandMenu'
import { useChipLabels } from './useChipLabels'
import type { LoadDynamicOptions, SkipArgFor } from './slashArgSources'

// The arg-spec types + the pure parser live in ONE shared leaf
// (`@localixai/api/slash-catalog`) consumed by every composer surface, so argument
// behaviour can never drift. This module keeps only the React hook.
export {
  parseCommandArgs,
  type SlashArgSpec,
  type SlashArgOption,
  type ParsedCommandArgs,
} from '@localixai/api/slash-catalog'
export type { LoadDynamicOptions, SkipArgFor } from './slashArgSources'

interface DetectedCommand {
  command: SlashCommand
  text: string
}

/**
 * Drives the chip/menu UX for a command's declarative arguments. Returns the parsed
 * state plus handlers that rebuild the raw prompt string the composer submits.
 */
export function useSlashArgs(
  detected: DetectedCommand | null,
  setPrompt: (v: string) => void,
  loadDynamicOptions?: LoadDynamicOptions,
  skipArg?: SkipArgFor,
  /** Wait before a dynamic argument's options load; a test passes 0. */
  debounceMs = 200,
) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [dynamicOptions, setDynamicOptions] = useState<{
    key: string
    options: SlashArgOption[]
  } | null>(null)

  const specs = detected?.command.args
  const prefix = detected ? (detected.command.prefix ?? `/${detected.command.trigger} `) : ''
  const parsed = useMemo<ParsedCommandArgs | null>(
    () =>
      specs && detected
        ? parseCommandArgs(
            detected.text,
            specs,
            skipArg && ((name, committed) => skipArg(detected.command, name, committed)),
          )
        : null,
    [specs, detected, skipArg],
  )
  const chipLabels = useChipLabels()
  const { remember } = chipLabels

  const buildPrompt = useCallback(
    (chipValues: string[], tail: string, trailingSpace = false) => {
      const chipPart = chipValues.join(' ')
      const body = chipPart ? `${chipPart} ${tail}` : tail
      return `${prefix}${body}${trailingSpace && !body.endsWith(' ') ? ' ' : ''}`
    },
    [prefix],
  )

  const enabled = Boolean(specs && parsed)
  const activeSpec = parsed?.activeSpec ?? null
  const choiceSpec =
    activeSpec && (activeSpec.type === 'choice' || activeSpec.type === 'interval')
      ? activeSpec
      : null
  const isDynamic = choiceSpec?.type === 'choice' && Boolean(choiceSpec.dynamic)
  const activeText = parsed?.activeText ?? ''

  // A dynamic arg's options load from its source (debounced, last-write-wins).
  // Keep the values in the dependency list rather than copying them into refs
  // during render: React can then cancel a stale request before it starts.
  const reqSeq = useRef(0)
  // The menu context (argument + typed text) the user last arrow-navigated in; a different
  // context means they have not navigated yet, so no reset is needed when it changes.
  const navigatedMenu = useRef<string | null>(null)
  const activeSpecName = activeSpec?.name
  const command = detected?.command
  const commandId = command?.id
  // The committed chips as data for the loader, plus a VALUE key for the cache and the
  // dependency list — memoized because a fresh object every render would refetch forever.
  const chips = parsed?.chips
  const committed = useMemo(
    () => Object.fromEntries((chips ?? []).map((chip) => [chip.spec.name, chip.option.value])),
    [chips],
  )
  const dynamicOptionsKey = JSON.stringify([
    commandId ?? '',
    activeSpecName ?? '',
    committed,
    activeText,
  ])
  useEffect(() => {
    if (!isDynamic || !command || !commandId || !activeSpecName || !loadDynamicOptions) return
    const seq = ++reqSeq.current
    const t = setTimeout(() => {
      void loadDynamicOptions(command, activeSpecName, activeText, committed)
        .then((options) => {
          remember(activeSpecName, options)
          if (reqSeq.current === seq) setDynamicOptions({ key: dynamicOptionsKey, options })
        })
        .catch(() => {
          if (reqSeq.current === seq) setDynamicOptions({ key: dynamicOptionsKey, options: [] })
        })
    }, debounceMs)
    return () => clearTimeout(t)
  }, [
    isDynamic,
    command,
    commandId,
    activeSpecName,
    activeText,
    committed,
    dynamicOptionsKey,
    loadDynamicOptions,
    debounceMs,
    remember,
  ])

  const options = useMemo(() => {
    if (!choiceSpec) return []
    // Dynamic: the source already filtered by the query — render as-is.
    if (isDynamic) return dynamicOptions?.key === dynamicOptionsKey ? dynamicOptions.options : []
    return filterArgOptions(choiceSpec, activeText)
  }, [choiceSpec, isDynamic, dynamicOptions, dynamicOptionsKey, activeText])
  // A flag that takes free text has no options, but still needs guidance: without it the menu
  // vanished right after `--description ` and the command looked finished. While the value is typed
  // the hint stays passive, so Space, arrows, Tab and Enter keep their text-field meaning.
  const flagChip = parsed?.chips.at(-1)
  const valueHint =
    activeSpec?.type === 'text' && flagChip?.spec.name === `flag:${activeSpec.name}`
      ? {
          flag: flagChip.option.label,
          description: flagChip.option.description ?? '',
          empty: !activeText.trim(),
        }
      : null
  const awaitingValue = valueHint?.empty === true
  const isMenuOpen = Boolean(choiceSpec && options.length > 0)
  const clampedIndex = Math.min(activeIndex, Math.max(0, options.length - 1))

  // A new argument or typed text restarts navigation: reset the highlight while rendering.
  const menuKey = `${activeSpecName ?? ''}\u0000${activeText}`
  const [indexKey, setIndexKey] = useState(menuKey)
  if (indexKey !== menuKey) {
    setIndexKey(menuKey)
    setActiveIndex(0)
  }

  /** Update the free text / partial token for the active argument. */
  const setActiveText = useCallback(
    (text: string) => {
      if (!parsed) return
      setPrompt(
        buildPrompt(
          parsed.chips.map((c) => c.option.value),
          text,
        ),
      )
    },
    [parsed, buildPrompt, setPrompt],
  )

  /** Commit a choice option and advance to the next argument. */
  const selectOption = useCallback(
    (opt: SlashArgOption) => {
      if (!parsed) return
      if (parsed.activeSpec) remember(parsed.activeSpec.name, [opt])
      const chipValues = [...parsed.chips.map((c) => c.option.value), opt.value]
      setPrompt(buildPrompt(chipValues, '', true))
    },
    [parsed, buildPrompt, setPrompt, remember],
  )

  /** Remove the chip at `index` and everything after it, reactivating that argument. */
  const clearArgFrom = useCallback(
    (index: number) => {
      if (!parsed) return
      const kept = parsed.chips.slice(0, index).map((c) => c.option.value)
      setPrompt(buildPrompt(kept, '', kept.length > 0))
    },
    [parsed, buildPrompt, setPrompt],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      // Clear the last committed chip with Backspace/Delete when the active arg's text
      // is empty — works whether or not the option menu is open (e.g. on the text arg).
      if (
        (e.key === 'Backspace' || e.key === 'Delete') &&
        (parsed?.activeText ?? '') === '' &&
        (parsed?.chips.length ?? 0) > 0
      ) {
        e.preventDefault()
        clearArgFrom(parsed!.chips.length - 1)
        return true
      }
      // The server rejects a flag without its value, so Enter waits for one; Backspace removes it.
      if (awaitingValue && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        return true
      }
      if (!isMenuOpen || options.length === 0) return false
      if (
        e.key === 'Enter' &&
        choiceSpec?.type === 'choice' &&
        choiceSpec.optional &&
        !activeText &&
        navigatedMenu.current !== menuKey
      )
        return false
      if (e.key === 'ArrowDown') {
        navigatedMenu.current = menuKey
        e.preventDefault()
        setActiveIndex((idx) => (idx + 1) % options.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        navigatedMenu.current = menuKey
        e.preventDefault()
        setActiveIndex((idx) => (idx - 1 + options.length) % options.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const opt = options[clampedIndex] ?? options[0]
        if (opt) {
          e.preventDefault()
          selectOption(opt)
          setActiveIndex(0)
          return true
        }
      }
      return false
    },
    [
      isMenuOpen,
      options,
      clampedIndex,
      selectOption,
      clearArgFrom,
      parsed,
      choiceSpec,
      activeText,
      awaitingValue,
      menuKey,
    ],
  )

  const labeledChips = useMemo(() => chipLabels.relabel(parsed?.chips ?? []), [chipLabels, parsed])

  return {
    enabled,
    chips: labeledChips,
    activeSpec,
    activeText: parsed?.activeText ?? '',
    // Every argument filled: say so instead of the command's generic "argument for…" hint.
    placeholder: activeSpec ? activeSpec.placeholder : enabled ? 'Enter to run…' : undefined,
    options,
    isMenuOpen,
    valueHint,
    activeIndex: clampedIndex,
    setActiveIndex,
    selectOption,
    setActiveText,
    clearArgFrom,
    handleKeyDown,
  }
}
