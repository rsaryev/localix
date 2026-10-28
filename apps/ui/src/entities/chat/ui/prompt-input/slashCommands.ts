/**
 * Slash-command picker hook.
 *
 * Data lives in commandList.tsx; icons in commandIcons.tsx.
 * This file contains only the hook logic and the command detection helper.
 */
import { useState, useCallback, useMemo } from 'react'
import type { SlashCommand } from './SlashCommandMenu'
import { ALL_SLASH_COMMANDS } from './commandList'
import { filterAndRankSlashCommands } from './slashCommandMatch'
import { BUILTIN_COMMAND_NAMES } from '@localixai/api/slash-catalog'

/**
 * Merge server-discovered commands in the same precedence the backend dispatches:
 * built-ins, then plugins, then skills. A lower-precedence collision is not merely
 * cosmetic: selecting either duplicate inserts the same slash token, so the server
 * would execute the higher-precedence owner while the menu described the other one.
 */
export function mergeDynamicSlashCommands(
  pluginCommands: readonly SlashCommand[],
  skillCommands: readonly SlashCommand[],
): SlashCommand[] {
  const claimed = new Set([...BUILTIN_COMMAND_NAMES].map((name) => name.toLowerCase()))
  const merged: SlashCommand[] = []
  for (const command of [...pluginCommands, ...skillCommands]) {
    const trigger = command.trigger.toLowerCase()
    if (claimed.has(trigger)) continue
    claimed.add(trigger)
    merged.push(command)
  }
  return merged
}

export function detectActiveCommand(
  prompt: string,
  commands: SlashCommand[],
): { command: SlashCommand; text: string } | null {
  for (const cmd of commands) {
    if (cmd.onChoose) continue
    const prefix = cmd.prefix ?? `/${cmd.trigger} `
    // Argless commands have no trailing separator in their insertion prefix. Do
    // not mistake `/helpful` for `/help`; an exact token or whitespace boundary
    // is required. Scoped prefixes such as `/x:` intentionally remain prefix-like.
    const matches = cmd.argless
      ? prompt === prefix || (prompt.startsWith(prefix) && /\s/.test(prompt[prefix.length] ?? ''))
      : prompt.startsWith(prefix)
    if (matches) {
      return { command: cmd, text: prompt.slice(prefix.length) }
    }
  }
  return null
}

/**
 * Text inserted after selecting a command from the menu.
 *
 * Skills are commands too: selecting `/sample-skill` must leave `/sample-skill ` in the
 * composer so the server's one-shot skill-command handler expands it for this
 * turn. It must not mutate the session's persistent `pinnedSkills` set.
 */
export function selectedCommandPrompt(command: SlashCommand): string {
  return command.prefix ?? `/${command.trigger} `
}

/** Route a pasted complete slash command through the same detector as typed input. */
export function pastedCommandPrompt(text: string, commands: SlashCommand[]): string | null {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  return detectActiveCommand(normalized, commands) ? normalized : null
}

/**
 * @param extraCommands Dynamic commands (e.g. user skills) appended AFTER the
 *   built-ins so they never push the core commands down the list.
 */
export function useSlashCommands(
  prompt: string,
  setPrompt: (v: string) => void,
  extraCommands: SlashCommand[] = [],
) {
  const [activeIndex, setActiveIndex] = useState(0)

  const commands = useMemo(() => [...ALL_SLASH_COMMANDS, ...extraCommands], [extraCommands])

  const detected = detectActiveCommand(prompt, commands)

  const slashMatch = !detected ? prompt.match(/^\/(\S*)$/) : null
  const isOpen = slashMatch !== null
  const query = slashMatch ? slashMatch[1].toLowerCase() : ''

  // Fuzzy filter + tiered rank (exact > prefix > substring > subsequence), with
  // group rank as the within-tier tiebreak — parity with the `@`-menu. The flat
  // order the hook returns is exactly the order SlashCommandMenu renders (it emits
  // group headers on change, AtRefMenu-style), so arrow-key nav stays aligned.
  const filtered = useMemo(
    () => (isOpen ? filterAndRankSlashCommands(query, commands) : []),
    [isOpen, query, commands],
  )
  const clampedIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1))

  // A filtered list is a new navigation context. Reset the highlight while rendering, so no
  // frame (and no event between frames) can select a row different from the highlighted one.
  const [indexQuery, setIndexQuery] = useState(query)
  if (indexQuery !== query) {
    setIndexQuery(query)
    setActiveIndex(0)
  }

  const handleSelect = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.onChoose) {
        cmd.onChoose()
        setPrompt('')
        return
      }
      setPrompt(selectedCommandPrompt(cmd))
    },
    [setPrompt],
  )

  const clearCommand = useCallback(() => {
    setPrompt('')
  }, [setPrompt])

  const acceptPastedCommand = useCallback(
    (text: string) => {
      const pasted = pastedCommandPrompt(text, commands)
      if (!pasted) return false
      setPrompt(pasted)
      return true
    },
    [commands, setPrompt],
  )

  const handleTextChange = useCallback(
    (text: string) => {
      if (!detected) return
      const prefix = detected.command.prefix ?? `/${detected.command.trigger} `
      setPrompt(prefix + text)
    },
    [detected, setPrompt],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen || filtered.length === 0) return false

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % filtered.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const cmd = filtered[clampedIndex] ?? filtered[0]
        if (cmd) {
          e.preventDefault()
          handleSelect(cmd)
          return true
        }
      }
      if (e.key === 'Escape') {
        setPrompt('')
        return true
      }
      return false
    },
    [isOpen, filtered, clampedIndex, handleSelect, setPrompt],
  )

  return {
    isOpen,
    filtered,
    query,
    activeIndex: clampedIndex,
    setActiveIndex,
    handleSelect,
    handleKeyDown,
    detected,
    clearCommand,
    handleTextChange,
    acceptPastedCommand,
  }
}
