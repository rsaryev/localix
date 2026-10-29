import type { ComponentKind, StoreComponent } from '@localixai/store'

type Part = Pick<StoreComponent, 'kind' | 'name' | 'description'>

/**
 * The order What's inside shows a package's kinds in: what the person opens and types first, then
 * how it looks, then what it hands the agent, and last what runs on its own.
 */
const ORDER: readonly ComponentKind[] = [
  'screen',
  'command',
  'skill',
  'agent',
  'output-style',
  'theme',
  'agent-tool',
  'mcp-server',
  'lsp-server',
  'hook',
  'mod',
  'monitor',
  'backend',
]

/** A package's parts in groups of one kind, in {@link ORDER}, each group in the package's order. */
export function groupParts<T extends Part>(
  parts: readonly T[],
): { kind: ComponentKind; parts: T[] }[] {
  return ORDER.map((kind) => ({ kind, parts: parts.filter((part) => part.kind === kind) })).filter(
    (group) => group.parts.length > 0,
  )
}

/** When a Claude Code hook event fires, said the way a person would. */
const HOOK_EVENTS: Record<string, string> = {
  SessionStart: 'When a session starts',
  SessionEnd: 'When a session ends',
  UserPromptSubmit: 'When you send a message',
  PreToolUse: 'Before each tool the agent uses',
  PostToolUse: 'After each tool the agent uses',
  PostToolUseFailure: 'After a tool the agent used fails',
  PermissionRequest: 'When the agent asks for permission',
  Notification: 'When the agent notifies you',
  Stop: 'When the agent finishes its answer',
  SubagentStart: 'When a subagent starts',
  SubagentStop: 'When a subagent finishes',
  PreCompact: 'Before the conversation is compacted',
}

/** What a part does: its own description, or for a hook when it fires; none says nothing. */
export function partDescription(part: Part): string | undefined {
  return part.description ?? (part.kind === 'hook' ? HOOK_EVENTS[part.name] : undefined)
}
