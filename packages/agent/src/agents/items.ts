/**
 * Barrel for the normalized **Item** model and its append stream.
 *
 * Split into two co-located modules so each stays focused; this path keeps its
 * historical surface so every importer (relative `./items` and the
 * `@localixai/agent/agents` barrel) is unaffected:
 *  - `./item-model` — the `AgentItem` taxonomy + type-narrowing guards.
 *  - `./item-appends` — the append-only item stream + its diff.
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

export type { AgentItemAppend } from './item-appends'

export { applyItemAppend, diffItemsForAppends } from './item-appends'
