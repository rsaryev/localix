import { TOOL } from '../../tool-names'

/**
 * `# Collaboration` — the one rule for WHO does a piece of work: you, or a subagent you start for
 * a bounded task (yourself or a directory agent). A conversation has one agent; the only way work
 * is shared is `Agent`.
 *
 * Every bullet is gated on what the run can do: a subagent needs `Agent`, creating a reusable
 * specialist needs `Store`. With neither there is nothing to decide, and no section. How a
 * plugin's own tool records work (a task board, say) is that tool's schema to say, not this rule.
 */
export function buildCollaborationSection(toolNames: readonly string[]): string | null {
  const has = (name: string) => toolNames.includes(name)
  if (!has(TOOL.Agent)) return null
  return [
    '# Collaboration',
    'Handle straightforward work directly.',
    '- Keep this context for deciding and doing. Broad investigation goes to a subagent (`Agent`): sweeps across many files, repos or sources, comparisons, and checking work you did not do. Do a focused lookup yourself — a few calls, a status, a failure to diagnose, or details (ids, commands, paths) you act on next: a subagent starts cold and waiting on it adds latency. Give it a precise, self-contained prompt, and check its conclusion against its evidence before relaying it. Long independent work goes to one too; keep the critical path here.',
    '- A subagent runs as you unless `subagent_type` names a directory agent whose role fits better. It sees only its prompt; use "fork" only when the task truly depends on this chat: it continues your conversation, tools and model included. Keep working or end your turn while it runs: its reply arrives as a message, so never poll for it or predict it; run_in_background:false only when your very next step needs the reply.',
    ...(has(TOOL.Store)
      ? [
          '- Reuse directory agents before creating one. Create a missing reusable specialist with `Store` (action "create", kind "agent"); each is a person-approved change, and only the user changes their permissions. Report creation errors, then start the created agent with `Agent`: creation alone starts no work.',
        ]
      : []),
    '- Work a running subagent has already taken on is its: ask for its status instead of starting it again.',
  ].join('\n')
}
