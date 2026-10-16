/**
 * useComposerCommands — unified composer command engine.
 *
 * Combines the slash-command picker (useSlashCommands) and the argument
 * chip/menu system (useSlashArgs) into a single hook so callers deal with
 * one object instead of two independently wired hooks.
 *
 * PromptInput is the primary consumer; it only needs to:
 *   1. Pass `composer.handleKeyDown` to the textarea.
 *   2. Conditionally render `SlashCommandMenu` when `composer.slash.isOpen`.
 *   3. Conditionally render `SlashArgMenu` when `composer.slashArgs.isMenuOpen`.
 *   4. Use `composer.textValue` / `composer.onTextChange` for the textarea.
 *   5. Use `composer.prefix` to render command + arg chips.
 */
import { useCallback } from 'react'
import type { SlashCommand } from './SlashCommandMenu'
import { useSlashCommands } from './slashCommands'
import { useSlashArgs, type LoadDynamicOptions, type SkipArgFor } from './SlashArgSpec'

export interface ComposerCommands {
  slash: ReturnType<typeof useSlashCommands>
  slashArgs: ReturnType<typeof useSlashArgs>
  /** Merged keydown handler — route to the textarea's onKeyDown. */
  handleKeyDown: (e: React.KeyboardEvent) => boolean
  /**
   * The value to show in the textarea (everything after the active prefix /
   * chips). When no command is active this equals the raw prompt.
   */
  textValue: string
  /** onChange for the textarea — writes back through the correct path. */
  onTextChange: (text: string) => void
  /** Placeholder driven by the active command/arg spec (or undefined = default). */
  commandPlaceholder: string | undefined
}

export function useComposerCommands(
  prompt: string,
  setPrompt: (v: string) => void,
  skillCommands: SlashCommand[] = [],
  loadDynamicOptions?: LoadDynamicOptions,
  skipArg?: SkipArgFor,
): ComposerCommands {
  const slash = useSlashCommands(prompt, setPrompt, skillCommands)
  const slashArgs = useSlashArgs(slash.detected, setPrompt, loadDynamicOptions, skipArg)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => slashArgs.handleKeyDown(e) || slash.handleKeyDown(e),
    [slashArgs, slash],
  )

  // Derive the textarea value: when an arg menu is active show only the
  // partial token; when just a command is active show the trailing text;
  // otherwise show the raw prompt.
  const textValue = slash.detected
    ? slashArgs.enabled
      ? slashArgs.activeText
      : slash.detected.text
    : prompt

  const onTextChange = slash.detected
    ? slashArgs.enabled
      ? slashArgs.setActiveText
      : slash.handleTextChange
    : setPrompt

  const commandPlaceholder = slash.detected
    ? slashArgs.enabled
      ? (slashArgs.placeholder ?? slash.detected.command.placeholder)
      : slash.detected.command.placeholder
    : undefined

  return {
    slash,
    slashArgs,
    handleKeyDown,
    textValue,
    onTextChange,
    commandPlaceholder,
  }
}
