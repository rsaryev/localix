/**
 * The small field helpers every Claude Code tool shape shares (`cc-tool-inputs.ts`,
 * `cc-tool-inputs-agentic.ts`, `cc-tool-responses.ts`), and the shape contract itself.
 */
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { expandHome } from '../../lib/home-path'

export type Fields = Record<string, unknown>

export interface ToolShape {
  /** Claude Code's name for the tool, when its input does not say otherwise. */
  name: string
  /** Every other Claude Code name the tool answers to (`Glob` for `search`). */
  names?: readonly string[]
  /** Claude Code's name for this call: `search` with only a `glob` is `Glob`. */
  nameFor?(input: Fields): string
  /**
   * The arguments as Claude Code's tool takes them, beside Localix's own. Given the call's
   * `cwd`, a file path is made absolute, as Claude Code's hooks always see it.
   */
  toClaude(input: Fields, cwd?: string): Fields
  /** Localix's input from what a hook passed on, Claude Code's fields folded back. */
  fromClaude(fields: Fields, name: string): Fields
  /** Localix fields the Claude Code view leaves out and a hook's rewrite keeps. */
  carry?(seen: Fields): Fields
}

export const isRecord = (value: unknown): value is Fields =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

/** The one entry of a list (`edits`, `files`), when there is exactly one. */
export const only = (value: unknown): Fields | undefined =>
  Array.isArray(value) && value.length === 1 && isRecord(value[0]) ? value[0] : undefined

export const without = (fields: Fields, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(fields).filter(([key]) => !keys.includes(key)))

export const defined = (fields: Fields) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))

/**
 * The directory a call's relative paths resolve against: its own `cwd` (relative to the hook's),
 * else the hook's. Without the hook's `cwd` nothing is resolved, so a path stays as written.
 */
export function baseOf(input: Fields, cwd: string | undefined): string | undefined {
  if (!cwd) return undefined
  const own = str(input.cwd)
  return own ? resolve(cwd, own) : cwd
}

/**
 * hooks.md: "For the file tools Write, Edit, and Read, tool_input.file_path is always absolute
 * … Claude Code expands ~ and relative paths before hooks run".
 */
export function absolutePath(path: unknown, base: string | undefined): unknown {
  if (typeof path !== 'string' || !path || !base) return path
  const expanded = expandHome(path, homedir())
  return isAbsolute(expanded) ? expanded : resolve(base, expanded)
}
