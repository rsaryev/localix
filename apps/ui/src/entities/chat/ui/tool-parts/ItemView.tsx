import { memo, useMemo, type ReactNode } from 'react'
import type { AgentItem, ToolCallItem } from '@localixai/agent/agents'
import { isUiNavigationOutput } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { AskToolPart } from './AskToolPart'
import { UiNavigationActionPart } from './UiNavigationActionPart'
import { CurrentToolCallProvider } from './toolTimingContext'
import { ToolCallDragContext, type ToolCallDragRef } from './toolCallDragContext'
import { ToolGateContext } from './toolGateContext'
import { ToolActionsProvider } from './toolActionsContext'
import { useIsForeignTranscript } from './foreignTranscriptContext'
import { CommandCard } from './cards/CommandCard'
import { FileChangeCard } from './cards/FileChangeCard'
import { McpCard } from './cards/McpCard'
import { GenericToolCard } from './cards/GenericToolCard'
import { contributedToolCard, getToolCard } from './cards/registry'
import { useToolCardsVersion } from '@/shared/contrib/toolCards'
import type { PresentableToolName } from './cards/meta'
import { useToolEventFocus } from './eventFocusTarget'
import { useRevealEnd } from '../useRunEventFocus'

/**
 * Thin dispatcher from a tool-backed `AgentItem` to its card. Specialized item
 * types (`command` / `file_change` / `mcp_call`) have dedicated cards; generic
 * `tool_call` items resolve a rich card by tool name via the cards registry,
 * falling back to {@link GenericToolCard}. Interactive built-ins keep their own
 * components; declarative tool UI is tool-name agnostic. A foreign
 * transcript opts out of all of it — see {@link useIsForeignTranscript}.
 */
// Keyed on the presentable-tool vocabulary, not `string`: these built-in names are
// bespoke surfaces in the transcript, and under a `string` key a rename or a
// typo would silently drop the HITL overlay for the plain generic card,
// with nothing to catch it. A `Partial` because this is an intentional opt-in subset.
const INTERACTIVE: Partial<Record<PresentableToolName, (item: ToolCallItem) => ReactNode>> = {
  ask: (item) => <AskToolPart item={item} />,
}

function renderItemInner(item: AgentItem, isForeign: boolean) {
  switch (item.type) {
    case 'text':
    case 'reasoning':
      // Narrative items are rendered by MessageCard directly (text bubble /
      // reasoning strip), not as cards — ItemView only handles tool-backed items.
      return null
    // The three typed branches stay outside the foreign guard on purpose. What
    // makes a foreign `tool_call` dangerous is that a free-string NAME is the
    // whole key while `input`/`output` are unknown, so a collision is invisible;
    // these carry their payload in named, typed fields, and nothing reaches them
    // without having built OUR item. Leaving the invariant with the projection
    // that owns it also means an adapter which starts emitting these surfaces as
    // a visibly wrong card, rather than being absorbed here into a plausible
    // generic one that nobody thinks to report.
    case 'command':
      return <CommandCard item={item} />
    case 'file_change':
      return <FileChangeCard item={item} />
    case 'mcp_call':
      return <McpCard item={item} />
    case 'tool_call': {
      // Someone else's agent gets IN/OUT and nothing else — unconditionally, not
      // as the fallback for a name that happens to miss. Every branch below reads
      // a payload only OUR tools emit: the registry keys on our tool vocabulary,
      // INTERACTIVE on our HITL contract, and the two sniffs on our
      // navigation and `ui` envelopes. A foreign transcript can satisfy any of
      // them by coincidence — a tool named `read`, an unrelated `ui` key — and
      // then renders a card that is wrong in a way that looks right.
      if (isForeign) return <GenericToolCard item={item} />
      const interactive = INTERACTIVE[item.name as PresentableToolName]
      if (interactive) return interactive(item)
      // A plugin's card for its own tool comes BEFORE the navigation sniff: the card
      // owns its output, an offered destination included, and a bare button would hide
      // everything else the call returned.
      const Contributed = contributedToolCard(item.name)
      if (Contributed) return <Contributed item={item} />
      // Standard serialized navigation actions are tool-name agnostic: built-ins
      // and plugins without a card get the same minimal, host-resolved button.
      if (isUiNavigationOutput(item.output)) return <UiNavigationActionPart item={item} />
      const Card = getToolCard(item.name) ?? GenericToolCard
      return <Card item={item} />
    }
  }
}

/** Renders one tool-backed AgentItem as a card. */
export const ItemView = memo(function ItemView({ item }: { item: AgentItem }) {
  const eventFocus = useToolEventFocus([item])
  const isEventTarget = eventFocus !== null
  useRevealEnd(eventFocus)
  // Tool-backed items expose their call identity so the shared card header
  // (ToolLine) can be dragged into the composer as a `@call:` context-ref.
  const dragRef = useMemo<ToolCallDragRef | null>(
    () =>
      'toolCallId' in item && typeof item.toolCallId === 'string' && item.toolCallId
        ? { toolCallId: item.toolCallId, name: item.name }
        : null,
    [item],
  )
  // Permission-gate provenance (user approval / session grant / allow rule) —
  // ToolLine reads it via context and renders the explain-shield for any card.
  const gate = 'toolCallId' in item ? (item.gate ?? null) : null
  const isForeign = useIsForeignTranscript()
  // A plugin's card registers after the transcript painted; subscribing re-renders this item
  // into it instead of leaving the generic card up until the item next changes.
  useToolCardsVersion()
  return (
    <div
      data-event-tool-target={dragRef?.toolCallId}
      className={cn('w-full rounded-xl', isEventTarget && 'lx-target-reveal')}
    >
      <CurrentToolCallProvider id={item.id}>
        <ToolCallDragContext.Provider value={dragRef}>
          <ToolActionsProvider actions={'actions' in item ? item.actions : undefined}>
            <ToolGateContext.Provider value={gate}>
              {renderItemInner(item, isForeign)}
            </ToolGateContext.Provider>
          </ToolActionsProvider>
        </ToolCallDragContext.Provider>
      </CurrentToolCallProvider>
    </div>
  )
})
