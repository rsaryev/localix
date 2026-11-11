import type { AgentDefinition } from '@rsaryev/llx-plugin'
import type { TaskAgentType } from '../tools/task-delegation-contracts'

/**
 * A kit-shaped agent type for tests: `name` is the full type (`plugin:agent` for a plugin's),
 * `ownName` its last segment, from a user folder unless `more` says otherwise.
 */
export function taskAgent(
  name: string,
  definition: Partial<AgentDefinition> = {},
  more: Partial<TaskAgentType> = {},
): TaskAgentType {
  return {
    name,
    ownName: name.split(':').at(-1) ?? name,
    source: { kind: 'folder', scope: 'user' },
    definition: { description: '', prompt: '', ...definition },
    extras: {},
    hooks: undefined,
    path: undefined,
    startsWith: { claudeMd: true, gitStatus: true },
    ...more,
  }
}
