import type { DiscoveredPlugin } from './discovery'
import { agentContributionSchema } from '../agents/contribution'

/** Agent definitions have a typed payload even though manifest contribution kinds are extensible. */
export function validateAgentContributions(plugin: DiscoveredPlugin): string[] {
  const errors: string[] = []
  const keys = new Set<string>()
  const handles = new Set<string>()
  for (const entry of plugin.manifest.contributions ?? []) {
    if (entry.kind !== 'agent') continue
    const parsed = agentContributionSchema.safeParse(entry.value)
    if (!parsed.success) {
      errors.push(
        `Agent contribution "${entry.key}" is invalid: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      )
      continue
    }
    if (keys.has(entry.key)) errors.push(`Duplicate agent contribution key "${entry.key}".`)
    if (handles.has(parsed.data.definition.handle))
      errors.push(`Duplicate native agent handle "${parsed.data.definition.handle}".`)
    keys.add(entry.key)
    handles.add(parsed.data.definition.handle)
  }
  return errors
}
