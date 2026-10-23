import { currentToolName } from './legacyToolNames'
import type { ComponentType } from 'react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { ReadCard } from './ReadCard'
import { SearchCard, GlobalSearchCard } from './SearchCard'
import { MemoryCard, SkillCard, JobsCard } from './actionCards'
import { TerminalToolCard } from './TerminalToolCard'
import { BrowserCard } from './BrowserCard'
import { PlanToolCard } from './PlanToolCard'
import { CodemodeCard } from './CodemodeCard'
import { isCoreToolMetaName, type PresentableToolName } from './meta'
import { toolCardFor } from '@/shared/contrib/toolCards'

export type ToolCardComponent = ComponentType<{ item: ToolCallItem }>

/**
 * Tool name → rich card for generic `tool_call` items. The dispatch point
 * ItemView consults, beside the mini-app-contributed cards below; anything absent
 * from both renders as GenericToolCard.
 * `command` / `file_change` / `mcp_call` items are typed and dispatch on
 * `item.type` in ItemView instead — they never pass through this map.
 *
 * Adding a rich card for a tool: create `cards/<X>Card.tsx` + one entry here
 * (+ a meta entry in `meta.ts` for its icon/verb/stacking).
 */
export const TOOL_CARDS: Partial<Record<PresentableToolName, ToolCardComponent>> = {
  read: ReadCard,
  // Historical items of the removed image tool: the same card, which shows a `read` image too —
  // a path, a size, the image glyph for `kind: 'image'`, and the picture itself.
  view_image: ReadCard,
  search: SearchCard,
  global_search: GlobalSearchCard,
  memory: MemoryCard,
  skill: SkillCard,
  jobs: JobsCard,
  // Interactive `bash` actions (open/screen/keys/type) arrive as tool_call items
  // named "bash" (plain commands are classified as `command` → CommandCard).
  bash: TerminalToolCard,
  browser: BrowserCard,
  plan: PlanToolCard,
  codemode: CodemodeCard,
}

/**
 * Resolve the card for a tool name (undefined → caller falls back to generic).
 *
 * The lookup takes a raw `string` — the name arrives off the wire, and a mini app tool
 * legitimately has no entry. The single cast is confined HERE on purpose: the map's
 * DECLARATION is what needed checking (a typo'd or renamed key silently downgrades a
 * rich card to the generic wrench, with no error anywhere), and one narrow accessor is
 * the right place to absorb the open keyspace.
 */
export function getToolCard(name: string): ToolCardComponent | undefined {
  return TOOL_CARDS[currentToolName(name) as PresentableToolName] ?? contributedToolCard(name)
}

/**
 * The card a mini app registered for a tool it owns (`host.toolCards`), if any.
 *
 * Asked separately because the dispatcher gives it a different place in line than a core card: a
 * mini app card renders its own output, navigation requests included, so it has to win over the
 * generic navigation button. A name the core table owns never resolves here — otherwise a mini app
 * registering `bash` would replace the terminal card of every chat.
 */
export function contributedToolCard(name: string): ToolCardComponent | undefined {
  if (isCoreToolMetaName(name)) return undefined
  return toolCardFor(name)?.Component
}
