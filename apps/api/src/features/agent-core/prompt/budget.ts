/** Aggregate caps prevent many individually-valid contributions from crowding out core context. */
export const PLUGIN_CONTEXT_TOTAL_MAX_CHARS = 12_000
export const MCP_INSTRUCTIONS_TOTAL_MAX_CHARS = 12_000
export const MCP_INVENTORY_TOTAL_MAX_CHARS = 4_000
export const PINNED_SKILLS_TOTAL_MAX_CHARS = 32_000
export const LOOPS_CONTEXT_TOTAL_MAX_CHARS = 8_000
export const ACTIVE_SUBAGENTS_TOTAL_MAX_CHARS = 8_000
export const BACKGROUND_JOBS_TOTAL_MAX_CHARS = 12_000

export function capAggregatePromptContext(
  content: string,
  maxChars: number,
  notice: string,
): string {
  const clean = content.trim()
  if (clean.length <= maxChars) return clean
  const separator = '\n\n'
  const keepChars = Math.max(0, maxChars - separator.length - notice.length)
  return `${clean.slice(0, keepChars).trimEnd()}${separator}${notice}`
}
