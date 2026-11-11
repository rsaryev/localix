import { z } from 'zod'
import type { CallClass } from '@localixai/agent/agents'

/**
 * The `Skill` tool's call contract: its input, the ports a host gives it, and what a call means to
 * the permission path (its effect, and the skill a `get` runs). The tool itself is `skill.ts`.
 */

export const skillToolInputSchema = z.object({
  action: z.enum(['save', 'get']),
  name: z.string().describe('e.g. "deploy-staging".'),
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
      'save: "project" (default, .claude/skills) or "global" (~/.claude/skills, every project).',
    ),
})

/**
 * Claude Code's `Skill` call, `{ skill, args }`, is a `get` of that skill with those arguments.
 * Localix's own calls (`action`, `name`) are left as written.
 */
export function prepareSkillArguments(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const { skill, args, ...rest } = raw as Record<string, unknown>
  if (typeof skill !== 'string') return raw
  return {
    ...rest,
    action: rest.action ?? 'get',
    name: rest.name ?? skill,
    ...(args !== undefined && rest.arguments === undefined ? { arguments: args } : {}),
  }
}

/** A `context: fork` skill's subagent, as `Agent` starts one (`AgentRequest`'s shape). */
export interface SkillForkRequest {
  title: string
  task: string
  agent?: string
  wait: boolean
  model?: string
  effort?: string
}

/** A skill as the host ran it: the text the model reads, or why it cannot run. */
export type SkillRun =
  | {
      ok: true
      text: string
      /** `context: fork`: the subagent's type, whether the call waits, and its model and effort. */
      fork?: { agent: string; wait: boolean; model?: string; effort?: string }
    }
  | { ok: false; message: string }

/** A skill a `get` found: the name it is called by, its own name, its file and its folder. */
export interface SkillEntry {
  name: string
  /** Without a plugin's prefix: what a monitor's `on-skill-invoke` names. */
  ownName: string
  scope: 'global' | 'project'
  path?: string
  dir?: string
  pluginName?: string
  /** The text as written: what a `get` returns when no host runs the skill. */
  content?: string
}

/** The skill a name calls, and every name the model may call (for the not-found answer). */
export interface SkillFound {
  skill?: SkillEntry
  names: readonly string[]
}

export interface SkillToolPorts {
  /**
   * Writes the skill a `save` hands over (`chat/skill-files.ts`): the project's
   * `.claude/skills` or the person's. Returns its `SKILL.md`. Absent: `save` is refused.
   */
  saveSkill?: (
    draft: { name: string; description: string; content: string },
    scope: 'global' | 'project',
  ) => Promise<string>
  /** The `SKILL.md` a `save` of the name writes, for the permission check before it runs. */
  skillFilePath?: (name: string, scope: 'global' | 'project') => string
  /**
   * Finds the skill a name calls as the chat's kit session names its skills (`skill-tool-ports.ts`),
   * its folders read again first. Absent: no skill is found.
   */
  findSkill?: (name: string, signal?: AbortSignal) => Promise<SkillFound>
  /**
   * Whether the person's latest message names the skill as a separate `/name` word: Claude Code
   * reads that as permission to run it for that message, a `disable-model-invocation` one too.
   */
  userNamed?: (callName: string) => boolean
  /**
   * Runs the skill as Claude Code runs it when Claude invokes it (the chat's kit session,
   * `skill-tool-ports.ts`): who may invoke it, its arguments, variables and injected commands, its
   * fork. Absent: the content as written, inline.
   */
  invokeSkill?: (
    skill: SkillEntry,
    request: { arguments: string; named: boolean; signal?: AbortSignal },
  ) => Promise<SkillRun>
  /** Runs a `context: fork` skill the agent loads as a subagent; absent: the skill runs inline. */
  forkSkill?: (
    toolCallId: string,
    request: SkillForkRequest,
  ) => Promise<{ content: string; isError?: boolean }>
}

/**
 * A `get` may run the skill's injected commands, but each one meets the run's permission rules as
 * a shell call first (the host's `invokeSkill`, `skill-tool-ports.ts`), so a read-only mode still
 * refuses a command that writes. A `save` writes a SKILL.md directory (`files`). Listing and
 * deleting skills belong to the Store (`store`); an unknown action, those two included, is
 * answered with the widest effect — on the permission path a guess must not open a door.
 */
export function classifySkillCall(input: unknown): CallClass {
  const action = input && typeof input === 'object' ? (input as { action?: unknown }).action : null
  if (action === 'get') return { effect: 'read' }
  if (action === 'save') return { effect: 'files' }
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
