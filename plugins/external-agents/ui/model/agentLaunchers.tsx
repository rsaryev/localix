import type { IconComponent } from '@localixai/plugin-sdk/ui'
import { ClaudeMark, CodexMark, CopilotMark, GeminiMark, HermesMark, OpencodeMark } from '../marks'
import { AGENT_LAUNCHERS, agentLaunchCommand } from '../../shared/launch'

/**
 * The BRAND half of a launcher — everything about it that only a UI can hold.
 *
 * The launchers themselves (provider, label, executable) live in `shared/launch.ts`, because the
 * backend probes those executables against PATH and cannot import a React component to find out
 * what they are called. What is left here is the mark, and the mark is not decoration: two
 * providers wearing the same lucide terminal made a roster row identifiable only by reading it.
 *
 * There used to be a third thing here — six `UiLocationContribution`s in a "Terminal profiles"
 * group, rendered by a chevron beside the tab strip's "+". They are gone, and not because the
 * surface was redundant: `useUiNavigation` dropped `target.command` on the floor, so every one of
 * those six clicks opened a plain shell. A launcher now has exactly ONE path — the titlebar's quick
 * actions, through `pluginTerminal.spawnCommand` — which is the path that was always working.
 */

/** Provider glyphs for the quick-action menu, the resource tree and the `@`-menu. */
export const AGENT_MARKS: Readonly<Record<string, IconComponent>> = {
  'claude-code': ClaudeMark,
  codex: CodexMark,
  opencode: OpencodeMark,
  'gemini-cli': GeminiMark,
  'github-copilot': CopilotMark,
  hermes: HermesMark,
}

/**
 * Re-exported, not re-implemented. The declaration format is the contract the backend observer
 * reads back off the pane, so it lives in `shared/launch.ts` where both halves derive from it —
 * see that file for why a drift there fails silently rather than loudly.
 */
export { AGENT_LAUNCHERS, agentLaunchCommand }
