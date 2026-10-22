import type { ClaudeTheme } from '@localixai/claude-plugin'

import type { PluginCatalog } from './catalog'
import type { PluginThemeSpec } from './contracts-themes'

/**
 * Claude Code color themes as Localix themes. A Claude Code theme recolors a terminal UI through
 * named tokens over a preset; Localix draws the same roles with its kit's CSS custom properties
 * (`packages/kit/styles/theme-*.css`). Each token whose role Localix draws maps to the properties
 * that draw it.
 *
 * A token for something Localix has no surface for has no counterpart and is dropped, as Claude
 * Code drops an unknown token:
 * - modes and indicators Localix labels in monochrome rather than colors: `planMode`, `autoAccept`,
 *   `bashBorder`, `ide`, `fastMode`, `effortUltra`, `remember`, `merged`;
 * - transcript rows Localix does not have: the dimmed diff of a rejected edit
 *   (`diffAddedDimmed`, `diffRemovedDimmed`), `!` shell and `#` memory entries
 *   (`bashMessageBackgroundColor`, `memoryBackgroundColor`), the `You`/`Claude` labels
 *   (`briefLabelYou`, `briefLabelClaude`) and a hovered message (`userMessageBackgroundHover`);
 * - `permission`: an approval is drawn with the same frame as every other overlay, so it has no
 *   border of its own to recolor;
 * - `composerSidebarBackground`: the panes beside the conversation are window-material grounds
 *   whose alpha lets the native material through (docs/internals/visual-system.md), so a flat
 *   color would cover it;
 * - the usage meter (`rate_limit_*`), the spinner shimmers (`*Shimmer`) and the `ultrathink`
 *   rainbow (`rainbow_*`).
 */
export const CC_THEME_TOKEN_VARS: Readonly<Record<string, readonly string[]>> = {
  // The brand accent: Claude Code's spinner and assistant label, Localix's composer glow.
  claude: ['--composer-accent'],
  text: ['--foreground', '--text-strong'],
  // Text on a filled control: Claude Code's status badges, Localix's primary button.
  inverseText: ['--primary-foreground'],
  // Hints, timestamps, disabled items.
  inactive: ['--text-soft', '--muted-foreground'],
  // Faint borders and de-emphasized text.
  subtle: ['--border-subtle', '--text-faint'],
  success: ['--status-success'],
  error: ['--status-error', '--destructive'],
  warning: ['--status-warning'],
  suggestion: ['--status-info'],
  promptBorder: ['--control-border'],
  // Diff rows and the words that changed inside them, in every diff view.
  diffAdded: ['--diff-added'],
  diffRemoved: ['--diff-removed'],
  diffAddedWord: ['--diff-added-word'],
  diffRemovedWord: ['--diff-removed-word'],
  // The person's own message bubble in the transcript.
  userMessageBackground: ['--user-message'],
  // Text selected with the mouse.
  selectionBg: ['--selection'],
  // The eight named subagent colors are Localix's identity colors.
  red_FOR_SUBAGENTS_ONLY: ['--conn-red'],
  blue_FOR_SUBAGENTS_ONLY: ['--conn-blue'],
  green_FOR_SUBAGENTS_ONLY: ['--conn-green'],
  yellow_FOR_SUBAGENTS_ONLY: ['--conn-amber'],
  orange_FOR_SUBAGENTS_ONLY: ['--conn-amber'],
  purple_FOR_SUBAGENTS_ONLY: ['--conn-violet'],
  pink_FOR_SUBAGENTS_ONLY: ['--conn-pink'],
  cyan_FOR_SUBAGENTS_ONLY: ['--conn-blue'],
}

/** A Claude Code theme as the UI applies it; daltonized and ANSI presets start from their tone. */
export function toLocalixTheme(pluginName: string, theme: ClaudeTheme): PluginThemeSpec {
  const overrides: Record<string, string> = {}
  for (const [token, color] of Object.entries(theme.overrides))
    for (const cssVar of CC_THEME_TOKEN_VARS[token] ?? []) overrides[cssVar] = color
  return {
    id: `${pluginName}:${theme.slug}`,
    pluginName,
    name: theme.name,
    base: theme.base.startsWith('light') ? 'light' : 'dark',
    overrides,
  }
}

/**
 * The themes of every ENABLED plugin in the scope: the global plugins' everywhere, and a project's
 * own plugins' while that project is open — Claude Code's `/theme` lists the themes of the plugins
 * the session loaded, and a project plugin loads only in its project. The device keeps a choice
 * whose plugin is not loaded and paints it again where it is (`apps/ui/src/shared/theme`).
 */
export function listThemesFromCatalog(catalog: PluginCatalog): PluginThemeSpec[] {
  return catalog.enabled.flatMap(({ plugin }) =>
    (plugin.entrypoints.components?.themes ?? []).map((theme) =>
      toLocalixTheme(plugin.manifest.name, theme),
    ),
  )
}
