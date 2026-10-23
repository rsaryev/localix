// Optional capability sections. Background jobs own their process-specific rendering
// (`background-jobs.ts`).

import {
  PLUGIN_CONTEXT_TOTAL_MAX_CHARS,
  MCP_INSTRUCTIONS_TOTAL_MAX_CHARS,
  MCP_INVENTORY_TOTAL_MAX_CHARS,
  PINNED_SKILLS_TOTAL_MAX_CHARS,
  LOOPS_CONTEXT_TOTAL_MAX_CHARS,
  ACTIVE_SUBAGENTS_TOTAL_MAX_CHARS,
  capAggregatePromptContext,
} from '../budget'

export function buildChannelSection(channel: string): string {
  return [
    '# Channel',
    `You are talking to the user over the **${channel}** channel (not the workspace UI).`,
    '- Just answer normally — your reply text is delivered back to them on that channel automatically.',
    '- Do NOT call a messaging/send tool, and do NOT ask for a chat or channel id, in order to reply HERE.',
    '- Reach for a send tool only to deliver to a DIFFERENT destination than this conversation.',
  ].join('\n')
}

export function buildSkillsSection(skillsContext: string): string | null {
  const clean = skillsContext.trim()
  if (!clean) return null
  return [
    '# Available skills',
    'Reusable procedures. Scan this list before starting a task: when a skill clearly covers the task, retrieve it (skill.get) and follow it rather than improvising a workflow it already encodes. A skill that is merely adjacent is not worth the round-trip — if none clearly applies, proceed without one.',
    clean,
  ].join('\n')
}

/**
 * Skills forced in by a keyword in the user's message. Volatile by nature — the trigger is
 * this turn's message — so it renders in the tail rather than the cached prefix; see
 * `../cache-tiers.test.ts`. Says WHICH keyword fired, because a procedure appearing unbidden is
 * confusing otherwise, and shares the pinned skills' aggregate cap and honest omission
 * notice rather than inventing a second budget.
 */
export function buildTriggeredSkillsSection(
  skills: { name: string; content: string; keyword: string }[],
): string | null {
  if (!skills.length) return null
  const blocks = capAggregatePromptContext(
    skills
      .map((s) => `## Skill: ${s.name} (triggered by "${s.keyword}")\n${s.content.trim()}`)
      .join('\n\n'),
    PINNED_SKILLS_TOTAL_MAX_CHARS,
    '[Additional triggered-skill instructions omitted: aggregate prompt budget reached. Do not assume omitted procedures are active in this prompt.]',
  )
  return [
    '# Triggered skills',
    "The user's message matched these skills' keywords — follow their procedures for this work:",
    '',
    blocks,
  ].join('\n')
}

export function buildPinnedSkillsSection(
  pinnedSkills: { name: string; content: string }[],
): string {
  const blocks = capAggregatePromptContext(
    pinnedSkills.map((s) => `## Skill: ${s.name}\n${s.content.trim()}`).join('\n\n'),
    PINNED_SKILLS_TOTAL_MAX_CHARS,
    '[Additional pinned-skill instructions omitted: aggregate prompt budget reached. Do not assume omitted procedures are active in this prompt.]',
  )
  return [
    '# Active skills (applied to this session)',
    'The user has applied these skills — follow their procedures for relevant work in this session:',
    '',
    blocks,
  ].join('\n')
}

export function buildPluginsSection(pluginsContext: string): string | null {
  const clean = capAggregatePromptContext(
    pluginsContext,
    PLUGIN_CONTEXT_TOTAL_MAX_CHARS,
    '[Additional plugin context omitted: aggregate prompt budget reached.]',
  )
  if (!clean) return null
  return [
    '# Plugins',
    'These user-enabled Claude Code plugins add skills you load with the skill tool, and language servers:',
    clean,
  ].join('\n')
}

export function buildMiniAppsSection(
  miniAppsContext: string,
  /** `activate_tools` is on the wire: some mini app tools wait behind it. */
  canActivate = false,
): string | null {
  const clean = capAggregatePromptContext(
    miniAppsContext,
    PLUGIN_CONTEXT_TOTAL_MAX_CHARS,
    '[Additional mini app context omitted: aggregate prompt budget reached.]',
  )
  if (!clean) return null
  // Mini app tools are DEFERRED until activated (chat/runtime/run/tool-deferral.ts): telling the
  // model every one is direct promised tools it had no schema for.
  return [
    '# Mini apps',
    canActivate
      ? 'These user-enabled mini apps are Localix apps with screens the person sees; their tools act on them. Direct tools are under "# Available tools"; the rest wait behind `activate_tools`, activated by exact name when the task matches:'
      : 'These user-enabled mini apps are Localix apps with screens the person sees; their tools act on them and are under "# Available tools". Use an app when the task matches:',
    clean,
  ].join('\n')
}

export function buildMcpInstructionsSection(
  instructions: { server: string; text: string }[],
): string {
  const guidance = capAggregatePromptContext(
    instructions.map((i) => `## ${i.server}\n${i.text}`).join('\n\n'),
    MCP_INSTRUCTIONS_TOTAL_MAX_CHARS,
    '[Additional MCP server instructions omitted: aggregate prompt budget reached.]',
  )
  return [
    '# MCP server instructions',
    'Connected MCP servers provided usage guidance for their tools — consult it when using a server:',
    guidance,
  ].join('\n')
}

/** A failed server's connection error, as much of it as the inventory line carries. */
const MCP_ERROR_MAX_CHARS = 300

export function buildMcpInventorySection(
  inventory: {
    server: string
    tools: string[]
    pending?: boolean
    failed?: boolean
    error?: string
  }[],
): string {
  const lines = inventory.map((entry) => {
    const server = entry.server.replace(/\s+/g, ' ').trim().slice(0, 128)
    if (entry.pending) {
      return `- ${server}: connecting in the background; optional tools may join on the next turn`
    }
    if (entry.failed) {
      // Claude Code tells Claude which server failed and its connection error.
      const error = entry.error?.replace(/\s+/g, ' ').trim().slice(0, MCP_ERROR_MAX_CHARS)
      const cause = error ? ` (connection error: ${error})` : ''
      return `- ${server}: FAILED to load this turn${cause}; its tools are unavailable right now. If the user asks for something it provides, say the server failed to load — do not say you lack the capability.`
    }
    return entry.tools.length > 0
      ? `- ${server}: ${entry.tools.length} tools loaded`
      : `- ${server}: connected; no tools exposed`
  })
  const roster = capAggregatePromptContext(
    lines.join('\n'),
    MCP_INVENTORY_TOTAL_MAX_CHARS,
    '[Additional connected MCP servers omitted: aggregate prompt budget reached.]',
  )
  return [
    '# MCP servers',
    'Connected servers are listed for provenance and readiness. Loaded MCP tool schemas are deferred; use `activate_tools` with exact names from its catalog before calling them. Activation lasts for the whole session — a tool you activated on an earlier turn is already in your tool list.',
    roster,
  ].join('\n')
}

export function buildScratchSection(scratchDir: string): string {
  return [
    '# Scratch space',
    `Your private, session-scoped scratch directory: \`${scratchDir}\``,
    "Use it for EVERY temporary file — throwaway scripts, test harnesses, intermediate results, downloads — instead of /tmp or the workspace. Reading, writing and running there never asks for approval and never touches the user's project.",
    "Files written here are NOT part of the user's workspace: a deliverable belongs in the workspace, not here. Tools/plugins that render from a file keep theirs in a subfolder here.",
  ].join('\n')
}

export function buildActiveSubAgentsSection(
  activeSubAgents: { title: string; task?: string }[],
  capabilities: { canInspectHistory: boolean; canListRuns: boolean },
): string {
  const recoveryNotice = capabilities.canListRuns
    ? '[Additional active sub-agents omitted: aggregate prompt budget reached. Use `delegate` action:"list" for your children.]'
    : capabilities.canInspectHistory
      ? '[Additional active sub-agents omitted: aggregate prompt budget reached. Use `global_search` for the full roster.]'
      : '[Additional active sub-agents omitted: aggregate prompt budget reached. Wait for their completion messages before overlapping their work.]'
  const roster = capAggregatePromptContext(
    activeSubAgents.map((a) => `- «${a.title}»${a.task ? ` — ${a.task}` : ''}`).join('\n'),
    ACTIVE_SUBAGENTS_TOTAL_MAX_CHARS,
    recoveryNotice,
  )
  const inspection = capabilities.canListRuns
    ? 'Use `delegate` action:"list" only when a report went missing or ownership is unclear; do not poll for completion. `delegate` action:"message" amends a child\'s task (a finished child runs again and reports again), action:"stop" ends its current run, and action:"close" ends a child you are done with for good.'
    : capabilities.canInspectHistory
      ? 'Use `global_search` only to recover a missed report or coordinate ownership; do not poll for completion.'
      : 'Wait for its completion message.'
  return [
    '# Active sub-agents',
    'These sub-agents are STILL RUNNING. Their results arrive automatically as new messages; continue independent work or end your turn instead of checking their status repeatedly.',
    '- Do NOT edit files inside their task scope, run conflicting commands, or fork overlapping work until they finish.',
    `- Do NOT fork the same task again. ${inspection}`,
    roster,
  ].join('\n')
}

export function buildLoopsSection(
  loops: readonly {
    id: string
    kind: 'fixed' | 'dynamic'
    cadence: string
    prompt: string
    target?: string
    lastRun?: string
  }[],
  capabilities: { canManage: boolean },
): string {
  const overflowNotice = capabilities.canManage
    ? '[Additional scheduled loops omitted: aggregate prompt budget reached. Use `loops` action="list" for the full roster.]'
    : '[Additional scheduled loops omitted: aggregate prompt budget reached.]'
  const loopRoster = capAggregatePromptContext(
    loops
      .map(
        (l) =>
          `- \`${l.id}\` · ${l.cadence}${l.target === 'subsession' ? ' · subsession' : ''}${l.lastRun ? ` · last: ${l.lastRun}` : ''} · "${l.prompt}"`,
      )
      .join('\n'),
    LOOPS_CONTEXT_TOTAL_MAX_CHARS,
    overflowNotice,
  )
  const guidance = [
    '# Loops',
    'The system already runs these scheduled jobs for this session. Each scheduled run delivers the task to you to perform ONCE:',
    loopRoster,
    '- When a loop task arrives, just do it once now and finish. The SYSTEM handles the repetition — you do NOT keep it running yourself.',
    '- The loop already IS the scheduler — never build your own recurrence to satisfy it (the anti-daemon rule in "# Execution discipline" applies), and do NOT remove or replace a loop unless the USER explicitly asks.',
    '- The loop does not produce output on its own — it is normal for nothing to have run yet and for files to be absent. Do not investigate whether the loop "is working"; just perform the task when its run arrives.',
  ]
  // WHEN to pace, not HOW: the `loops` schema owns the call semantics (reschedule by id,
  // `delay_seconds`, no second job for one task). This line used to restate them, and the dedup
  // lint carried the overlap as four known duplicates.
  guidance.push(
    capabilities.canManage
      ? '- A **dynamic** loop (cadence "dynamic") paces itself: when its task is done, set its next run with `loops` action="reschedule" (or "remove" to stop it).'
      : '- Loop-management controls are not available in this run. Do not claim that you listed, rescheduled, removed, or otherwise changed a loop.',
  )
  return guidance.join('\n')
}
