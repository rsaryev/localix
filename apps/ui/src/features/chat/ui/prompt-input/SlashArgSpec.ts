import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  parseCommandArgs,
  filterArgOptions,
  type SlashArgOption,
  type ParsedCommandArgs,
} from '@localixai/api/slash-catalog'
import type { SlashCommand } from './SlashCommandMenu'

// The arg-spec types + the pure parser live in ONE shared leaf
// (`@localixai/api/slash-catalog`) consumed by every composer surface, so argument
// behaviour can never drift. This module keeps only the React hook.
export {
  parseCommandArgs,
  INTERVAL_TOKEN_RE,
  type SlashArgSpec,
  type SlashArgOption,
  type ArgCondition,
  type ParsedArgChip,
  type ParsedCommandArgs,
} from '@localixai/api/slash-catalog'

interface DetectedCommand {
  command: SlashCommand
  text: string
}

/**
 * Drives the chip/menu UX for a command's declarative arguments. Returns the parsed
 * state plus handlers that rebuild the raw prompt string the composer submits.
 */
/**
 * Fetch a dynamic arg's options on demand (a plugin `optionsScript` arg, or a
 * built-in whose values are live state). Given the active command, the arg name, the
 * partial text, and the arguments ALREADY committed as chips; returns the option
 * list. The composer wires this up; omit for surfaces with no dynamic args.
 *
 * `committed` is what makes one arg spec serve several sub-commands: `/plugin enable`
 * and `/plugin disable` share the "pick an installed plugin" argument, and only the
 * committed action says which half of the installed set is worth offering.
 */
export type LoadDynamicOptions = (
  command: SlashCommand,
  argName: string,
  query: string,
  committed: Readonly<Record<string, string>>,
) => Promise<SlashArgOption[]>

export function useSlashArgs(
  detected: DetectedCommand | null,
  setPrompt: (v: string) => void,
  loadDynamicOptions?: LoadDynamicOptions,
) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [dynamicOptions, setDynamicOptions] = useState<{
    key: string
    options: SlashArgOption[]
  } | null>(null)

  const specs = detected?.command.args
  const prefix = detected ? (detected.command.prefix ?? `/${detected.command.trigger} `) : ''
  const parsed = useMemo<ParsedCommandArgs | null>(
    () => (specs && detected ? parseCommandArgs(detected.text, specs) : null),
    [specs, detected],
  )

  const buildPrompt = useCallback(
    (chipValues: string[], tail: string, trailingSpace = false) => {
      const chipPart = chipValues.join(' ')
      const body = chipPart ? `${chipPart} ${tail}` : tail
      return `${prefix}${body}${trailingSpace ? ' ' : ''}`
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
          if (reqSeq.current === seq) setDynamicOptions({ key: dynamicOptionsKey, options })
        })
        .catch(() => {
          if (reqSeq.current === seq) setDynamicOptions({ key: dynamicOptionsKey, options: [] })
        })
    }, 200)
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
  ])

  const options = useMemo(() => {
    if (!choiceSpec) return []
    // Dynamic: the source already filtered by the query — render as-is.
    if (isDynamic) return dynamicOptions?.key === dynamicOptionsKey ? dynamicOptions.options : []
    return filterArgOptions(choiceSpec, activeText)
  }, [choiceSpec, isDynamic, dynamicOptions, dynamicOptionsKey, activeText])
  const isMenuOpen = Boolean(choiceSpec && options.length > 0)
  const clampedIndex = Math.min(activeIndex, Math.max(0, options.length - 1))

  useEffect(() => setActiveIndex(0), [activeSpecName, activeText])

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
      const chipValues = [...parsed.chips.map((c) => c.option.value), opt.value]
      setPrompt(buildPrompt(chipValues, '', true))
    },
    [parsed, buildPrompt, setPrompt],
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
      if (!isMenuOpen || options.length === 0) return false
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((idx) => (idx + 1) % options.length)
        return true
      }
      if (e.key === 'ArrowUp') {
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
    [isMenuOpen, options, clampedIndex, selectOption, clearArgFrom, parsed],
  )

  return {
    enabled,
    chips: parsed?.chips ?? [],
    activeSpec,
    activeText: parsed?.activeText ?? '',
    placeholder: activeSpec?.placeholder,
    options,
    isMenuOpen,
    activeIndex: clampedIndex,
    setActiveIndex,
    selectOption,
    setActiveText,
    clearArgFrom,
    handleKeyDown,
  }
}
