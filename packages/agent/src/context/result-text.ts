import type { ToolBackedItem } from '../agents/items'

/**
 * Model-facing result text of a tool-backed item, mirroring `itemsToWireMessages`'
 * `resultContent` preference order (error.userMessage → resultText → errorText),
 * so size thresholds reflect what actually re-enters the prompt. Rich display-only
 * fields (command `output`, file_change `diff`) are deliberately NOT model text.
 */
export function itemResultModelText(item: ToolBackedItem): string {
  return item.error?.userMessage ?? item.resultText ?? item.errorText ?? ''
}
