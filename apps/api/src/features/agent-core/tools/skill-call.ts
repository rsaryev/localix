import { z } from 'zod'
import type { CallClass } from '@localixai/agent/agents'

/**
 * The `skill` tool's call contract: its input, the ports a host gives it, and what a call means to
 * the permission path (its effect, and the skill a `get` runs). The tool itself is `skill.ts`.
 */

export const skillToolInputSchema = z.object({
  action: z.enum(['save', 'get', 'list', 'delete']),
  name: z.string().optional().describe('e.g. "deploy-staging". Required except for list.'),
  description: z.string().optional().describe('save: one line.'),
  content: z.string().optional().describe('save: the full procedure.'),
  arguments: z
    .string()
    .optional()
    .describe('get: the arguments to run the skill with, as typed after /name.'),
  scope: z
    .enum(['project', 'global'])
    .optional()
    .describe(
      'save: "project" (default, .localix/skills) or "global" (~/.localix/skills, every project).',
    ),
})

/** A `context: fork` skill's subagent, as `delegate` starts one (`DelegateRequest`'s shape). */
export interface SkillForkRequest {
  title: string
  task: string
  agent?: string
  wait: boolean
  model?: string
  effort?: string
}

export interface SkillToolPorts {
  /**
   * Whether the person's latest message names the skill as a separate `/name` word: Claude Code
   * reads that as permission to run it for that message, a `disable-model-invocation` one too.
   */
  userNamed?: (callName: string) => boolean
  /** Runs a `context: fork` skill the agent loads as a subagent; absent: the skill runs inline. */
  forkSkill?: (
    toolCallId: string,
    request: SkillForkRequest,
  ) => Promise<{ content: string; isError?: boolean }>
}

/**
 * Discovery stays available under a read-only rule: an agent should be able to SEE which skills
 * exist before proposing one, so only the two writing actions are blocked there. A `get` may run
 * the skill's injected commands, but each one meets the run's permission rules as a shell call
 * first (the host's `renderSkill`, `skill-tool-ports.ts`), so a read-only mode still refuses a
 * command that writes. Both write a
 * SKILL.md directory (`files`); a delete removes it recursively and cannot be redone. An unknown
 * action is answered with the widest effect — on the permission path a guess must not open a door.
 */
export function classifySkillCall(input: unknown): CallClass {
  const action = input && typeof input === 'object' ? (input as { action?: unknown }).action : null
  if (action === 'list' || action === 'get') return { effect: 'read' }
  if (action === 'save') return { effect: 'files' }
  if (action === 'delete') return { effect: 'files', irreversible: true }
  return { effect: 'external' }
}

/**
 * The skill a `get` runs, as a permission rule names it (`Skill(deploy)` in a skill's
 * `allowed-tools`, `skill` + `deploy` in Localix's rules). Other actions name no skill to run.
 */
export function skillPermissionResources(input: unknown): string[] {
  const record = (input ?? {}) as { action?: unknown; name?: unknown }
  return record.action === 'get' && typeof record.name === 'string' && record.name
    ? [record.name]
    : []
}
