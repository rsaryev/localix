/**
 * Barrel for the normalized **Item** model and its lifecycle reducer.
 *
 * Split into two co-located modules so each stays focused; this path keeps its
 * historical surface so every importer (relative `./items` and the
 * `@localixai/agent/agents` barrel) is unaffected:
 *  - `./item-model` — the `AgentItem`/`TurnState` taxonomy + type-narrowing guards.
 *  - `./item-events` — the `AgentItemEvent`/`AgentTurnEvent` taxonomy + pure reducer.
 */

export type {
  AgentItem,
  AgentItemStatus,
  AgentItemType,
  CommandItem,
  CommandJobStatus,
  FileChange,
  FileChangeItem,
  FileChangeKind,
  McpCallItem,
  NarrativeItem,
  ReasoningItem,
  StopReason,
  TextItem,
  ToolBackedItem,
  ToolCallItem,
  ToolImageAttachment,
  TurnState,
  TurnStatus,
  TurnUsage,
} from './item-model'

export {
  hasItemError,
  isCommandItem,
  isFileChangeItem,
  isItemStreaming,
  isMcpCallItem,
  isNarrativeItem,
  isReasoningItem,
  isTextItem,
  isToolBackedItem,
  isToolCallItem,
} from './item-model'

export type { AgentItemEvent, AgentTurnEvent } from './item-events'

export { applyItemEvent, applyTurnEvent, emptyTurn } from './item-events'

export type { AgentItemAppend } from './item-appends'

export { applyItemAppend, diffItemsForAppends } from './item-appends'
