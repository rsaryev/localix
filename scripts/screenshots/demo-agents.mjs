import { api } from './runtime.mjs'

/** Specialists are explicitly authored fixture data, never implied shipped presets. */
export async function ensureDemoAgents(projectId) {
  const { agents } = await api(`/capabilities/snapshot?projectId=${encodeURIComponent(projectId)}`)
  const ids = { localix: 'builtin:localix' }
  for (const [handle, description, instructions] of [
    [
      'frontend',
      'Reviews the demo interface.',
      'Review interface states and report rendered evidence.',
    ],
    [
      'qa',
      'Checks the demo release.',
      'Check release states and report concrete findings and evidence.',
    ],
    [
      'lead',
      'Owns the demo release notes and docs.',
      'Write release notes and keep documentation current.',
    ],
  ]) {
    const existing = agents.find((agent) => agent.record.name === handle)
    // Made the way a person makes one, through the Store; its instructions are then its config.
    const id =
      existing?.record.id ??
      (
        await api('/store/create/agent', {
          scope: 'project',
          values: { name: handle, description },
          projectId,
        })
      ).ref.id
    if (!existing)
      await api(`/store/agent/${encodeURIComponent(id)}/config`, {
        scope: 'project',
        values: { instructions },
        projectId,
      })
    // An agent file a fresh database finds in the project starts off, as any cloned repo's would;
    // the person switches it on in the Store.
    if (existing && !existing.enabled)
      await api(`/store/agent/${encodeURIComponent(id)}/enable`, {
        scope: 'project',
        enabled: true,
        projectId,
      })
    ids[handle] = id
  }
  return ids
}
