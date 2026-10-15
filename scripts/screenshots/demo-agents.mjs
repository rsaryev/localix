import { api } from './runtime.mjs'

/** Specialists are explicitly authored fixture data, never implied shipped presets. */
export async function ensureDemoAgents(projectId) {
  const { agents } = await api(`/capabilities/snapshot?projectId=${encodeURIComponent(projectId)}`)
  const ids = { localix: 'builtin:localix' }
  for (const [handle, label, description, instructions] of [
    [
      'frontend',
      'Frontend',
      'Reviews the demo interface.',
      'Review interface states and report rendered evidence.',
    ],
    [
      'qa',
      'QA Engineer',
      'Checks the demo release.',
      'Check release states and report concrete findings and evidence.',
    ],
  ]) {
    const existing = agents.find((agent) => agent.record.handle === handle)
    const agent =
      existing ??
      (await api('/agents', {
        handle,
        label,
        description,
        instructions,
        leadershipPriority: 0,
        projectId,
      }))
    ids[handle] = agent.record.id
    // A fresh workspace seeds a starter team with these handles switched off and barred from
    // chat; a session refuses such a participant, so the fixture opens the ones it seats.
    if (existing)
      await api('/capabilities/rules/apply', {
        agentId: agent.record.id,
        changes: [
          { action: `agent:${agent.record.id}`, resource: '*', effect: 'allow' },
          { action: 'invocation:chat', resource: agent.record.id, effect: 'allow' },
        ],
      })
  }
  return ids
}
