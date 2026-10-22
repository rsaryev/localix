import {
  choosePluginTheme,
  clearPluginTheme,
  scopeThemes,
  currentPluginTheme,
  type PluginThemeSpec,
} from './pluginTheme'
import { currentThemeSelection, setThemeMode, type ResolvedTheme, type ThemeMode } from './useTheme'

/**
 * What the person picks a look from, in Settings → Appearance and with `/theme`: the three
 * appearances, then the open scope's plugin themes (Claude Code's `/theme` lists the presets, then
 * the custom and plugin themes). One list and one apply step for both surfaces.
 */
export interface ThemeChoice {
  /** `system`/`light`/`dark`, or `plugin:<plugin>:<slug>` — never collides with an appearance. */
  value: string
  label: string
  description?: string
}

const APPEARANCES: readonly ThemeChoice[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** A plugin theme's choice value. */
export const pluginThemeValue = (theme: PluginThemeSpec) => `plugin:${theme.id}`

/** The appearances, then each plugin theme, marked with the plugin it comes from. */
export function themeChoices(themes: readonly PluginThemeSpec[]): ThemeChoice[] {
  return [
    ...APPEARANCES,
    ...themes.map((theme) => ({
      value: pluginThemeValue(theme),
      label: theme.name,
      description: `From ${theme.pluginName}`,
    })),
  ]
}

/**
 * The choice that is showing: the chosen plugin theme while the scope lists it and the window shows
 * its base, else the appearance.
 */
export function currentThemeValue(
  chosen: PluginThemeSpec | null,
  themes: readonly PluginThemeSpec[],
  selection: { themeMode: ThemeMode; resolvedTheme: ResolvedTheme },
): string {
  return chosen &&
    chosen.base === selection.resolvedTheme &&
    themes.some((theme) => theme.id === chosen.id)
    ? pluginThemeValue(chosen)
    : selection.themeMode
}

/** Apply a choice: a plugin theme switches to its base first, then lays itself over it. */
export function selectTheme(
  value: string,
  themes: readonly PluginThemeSpec[],
  setMode: (mode: ThemeMode) => void,
): void {
  const theme = themes.find((entry) => pluginThemeValue(entry) === value)
  if (theme) {
    setMode(theme.base)
    choosePluginTheme(theme)
    return
  }
  clearPluginTheme()
  setMode(value as ThemeMode)
}

/**
 * The choice a typed name means, ignoring case as Claude Code's `/theme` does: an appearance, a
 * theme's name, its `<plugin>:<slug>` id or its bare slug. A name two plugins share is ambiguous.
 */
export function findThemeChoice(
  query: string,
  themes: readonly PluginThemeSpec[],
): { kind: 'found'; choice: ThemeChoice } | { kind: 'none' | 'ambiguous' } {
  const wanted = query
    .trim()
    .toLowerCase()
    .replace(/^plugin:/, '')
  const appearance = APPEARANCES.find((choice) => choice.value === wanted)
  if (appearance) return { kind: 'found', choice: appearance }
  const byId = themes.find((theme) => theme.id.toLowerCase() === wanted)
  const matches = byId
    ? [byId]
    : themes.filter(
        (theme) =>
          theme.name.toLowerCase() === wanted ||
          theme.id.slice(theme.id.indexOf(':') + 1).toLowerCase() === wanted,
      )
  if (matches.length === 1) {
    const choice = themeChoices(matches).at(-1)!
    return { kind: 'found', choice }
  }
  return { kind: matches.length > 1 ? 'ambiguous' : 'none' }
}

/** The list `/theme` prints, the current choice marked. */
export function themeListing(choices: readonly ThemeChoice[], current: string): string {
  return choices
    .map(
      (choice) =>
        `${choice.label}${choice.description ? ` (${choice.description.toLowerCase()})` : ''}${choice.value === current ? ' — current' : ''}`,
    )
    .join('\n')
}

export interface ThemeCommandResult {
  kind: 'listed' | 'switched' | 'unknown'
  title: string
  detail?: string
}

/**
 * `/theme [name]`: with no name, list the looks and mark the current one; with one, switch to it.
 * The look is this device's, so the command runs here and never reaches the agent.
 */
export function runThemeCommand(
  argument: string,
  deps: {
    themes?: readonly PluginThemeSpec[]
    selection?: { themeMode: ThemeMode; resolvedTheme: ResolvedTheme }
    chosen?: PluginThemeSpec | null
    setMode?: (mode: ThemeMode) => void
  } = {},
): ThemeCommandResult {
  const themes = deps.themes ?? scopeThemes()
  const choices = themeChoices(themes)
  const current = currentThemeValue(
    deps.chosen === undefined ? currentPluginTheme() : deps.chosen,
    themes,
    deps.selection ?? currentThemeSelection(),
  )
  const listing = themeListing(choices, current)
  if (!argument.trim())
    return { kind: 'listed', title: 'Themes — /theme <name> to switch', detail: listing }
  const found = findThemeChoice(argument, themes)
  if (found.kind !== 'found')
    return {
      kind: 'unknown',
      title:
        found.kind === 'ambiguous'
          ? `Several plugins have a theme named "${argument.trim()}" — use <plugin>:<theme>`
          : `No theme "${argument.trim()}"`,
      detail: listing,
    }
  selectTheme(found.choice.value, themes, deps.setMode ?? setThemeMode)
  return { kind: 'switched', title: `Theme set to ${found.choice.label}` }
}

/** The text after `/theme`, or null when `text` is not the command. */
export function themeCommandArgument(text: string): string | null {
  const match = /^\/theme(?:\s+([\s\S]*))?$/i.exec(text.trim())
  return match ? (match[1] ?? '').trim() : null
}
