import { z } from 'zod'
import { truncateHead } from '@localixai/agent'
import { errorMessage } from '../../../lib/errors'
import { homedir } from 'node:os'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'
import { TOOL } from '../tool-names'
import {
  discoverFilesystemSkills,
  writeSkillFile,
  deleteSkillByName,
  type DiscoveredSkill,
} from '../skill-discovery'
import { recordSkillUse } from '../skill-usage-recorder'
import { MAX_OUTPUT_BYTES } from './file/read-output'
import { truncationMarker } from './tool-output'
import { filterDisabledSkills, isSkillDisabled, type SkillOverrides } from '../skill-overrides'

const skillToolInputSchema = z.object({
  action: z.enum(['save', 'get', 'list', 'delete']),
  name: z.string().optional().describe('e.g. "deploy-staging". Required except for list.'),
  description: z.string().optional().describe('save: one line.'),
  content: z.string().optional().describe('save: the full procedure.'),
  scope: z
    .enum(['project', 'global'])
    .optional()
    .describe(
      'save: "project" (default, .localix/skills) or "global" (~/.localix/skills, every project).',
    ),
})

/**
 * Discovery stays available under a read-only rule: an agent should be able to SEE which skills
 * exist before proposing one, so only the two writing actions are blocked there. Both write a
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
 * Filesystem-backed skill management. Skills are directories containing a
 * SKILL.md (plus any scripts/assets the agent adds with the write/bash tools).
 * They are discovered by walking up from `workingDir` and falling back to the
 * home dir — no database involved, so skills are portable and shippable.
 *
 * @param workingDir The session's project working dir, or null/'/' if none.
 * @param extraSkills Read-only skills contributed outside the filesystem scopes
 *   (e.g. plugin-bundled skills from `loadEnabledPlugins`). They are visible to
 *   `get`/`list` but cannot be saved over or deleted — saving always targets
 *   the filesystem scopes, and a filesystem skill of the same name wins.
 * @param skillOverrides User visibility policy. `off` removes a skill from every
 *   model-facing action, including guessed names.
 * @param projectId Exact project scope for usage telemetry. Empty means sessions
 *   without a project.
 * @param onSkillsChanged Host port, called after a `save` or `delete` changed the skill set.
 *   A skill is a capability: it rides in the capability snapshot and in a run's
 *   "# Available skills", both of which are refreshed only when the capability revision moves.
 *   The tool wrote SKILL.md and announced nothing, so the Skills list stayed stale and the
 *   next run's prompt could omit what the agent had just saved — until an unrelated plugin
 *   or MCP toggle happened to bump the revision. Injected rather than imported: the
 *   announcement (bump + client poke) belongs to the host, not to agent-core.
 */
export function createSkillTool(
  workingDir?: string | null,
  extraSkills: DiscoveredSkill[] = [],
  skillOverrides: SkillOverrides = {},
  projectId = '',
  onSkillsChanged?: () => void,
) {
  const announce = () => {
    try {
      onSkillsChanged?.()
    } catch {
      // The file is written; a failed announcement must not turn that into an error result.
    }
  }
  const projectBase = workingDir && workingDir !== '/' ? workingDir : null

  // Filesystem skills win on a name clash (same precedence the system prompt uses
  // in agent-runner: fileSkills before loadedPlugins.skills).
  const allSkills = async (): Promise<DiscoveredSkill[]> => {
    const fileSkills = await discoverFilesystemSkills(projectBase)
    const byName = new Map<string, DiscoveredSkill>()
    for (const s of [...fileSkills, ...extraSkills]) {
      if (!byName.has(s.name)) byName.set(s.name, s)
    }
    return filterDisabledSkills([...byName.values()], skillOverrides).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }

  const notFoundMessage = (name: string, skills: DiscoveredSkill[]): string => {
    if (skills.length === 0) return `Skill not found: "${name}". No skills are available.`
    const names = skills.map((s) => s.name)
    const shown = names.slice(0, 30)
    const more = names.length > shown.length ? ` (+${names.length - shown.length} more)` : ''
    return `Skill not found: "${name}". Available skills: ${shown.join(', ')}${more}`
  }
  return defineAgentTool({
    name: TOOL.skill,
    label: 'Skill',
    activeVerb: 'Managing skill',
    // No "call list first": the skills that exist are already listed in the prompt's
    // "# Available skills", and telling the model to list them again bought a wasted call.
    // The name case agrees with the `name` example below; the two used to disagree.
    description:
      'Save, get, list and delete reusable skills (SKILL.md files; scripts/assets beside them via write/bash). After a non-trivial reusable workflow (a tricky fix, a multi-step procedure) save it under a kebab-case verb name; never save one-off answers, and fix a skill the moment it turns out wrong.',
    inputSchema: skillToolInputSchema,
    // `save` writes <base>/.localix/skills/<name>/SKILL.md and `delete` removes that dir
    // recursively. With `scope:"global"` the base is homedir(), i.e. outside the workspace —
    // which is exactly what the confirmation prompt exists for.
    mutates: true,
    classify: classifySkillCall,
    executionMode: 'sequential',
    // get/list only read, so they overlap other reads; save/delete stay a barrier in their turn.
    executionModeFor: (input) =>
      classifySkillCall(input).effect === 'read' ? 'parallel' : 'sequential',
    async execute(_toolCallId, input) {
      switch (input.action) {
        case 'save': {
          if (!input.name) return { content: 'name is required for action="save".', isError: true }
          if (isSkillDisabled(skillOverrides, input.name)) {
            return { content: 'That skill name is unavailable.', isError: true }
          }
          if (!input.description)
            return { content: 'description is required for action="save".', isError: true }
          if (!input.content)
            return { content: 'content is required for action="save".', isError: true }
          const isGlobal = input.scope === 'global' || !projectBase
          const base = isGlobal ? homedir() : projectBase
          try {
            const dir = await writeSkillFile(
              base,
              { name: input.name, description: input.description, content: input.content },
              isGlobal ? 'global' : 'project',
            )
            announce()
            return {
              content: `Skill saved: "${input.name}" → ${dir}/SKILL.md (${isGlobal ? 'global' : 'project'})`,
            }
          } catch (e) {
            return { content: `Error saving skill: ${errorMessage(e)}`, isError: true }
          }
        }

        case 'get': {
          if (!input.name) return { content: 'name is required for action="get".', isError: true }
          const skills = await allSkills()
          const skill = skills.find((s) => s.name === input.name)
          if (!skill) return { content: notFoundMessage(input.name, skills), isError: true }
          let body: string
          try {
            body = skill.content
          } catch (error) {
            return {
              content: `Skill "${skill.name}" could not be loaded: ${errorMessage(error).slice(0, 500)}`,
              isError: true,
            }
          }
          // Curator usage telemetry — best-effort, never blocks the get.
          recordSkillUse(skill.name, skill.scope, skill.scope === 'project' ? projectId : '')
          // Progressive loading must retain provenance: bundled scripts,
          // references, and assets are relative to the skill directory. Pi
          // wraps explicit skill bodies with baseDir and Codex injects their
          // path; returning only the body makes those relative links unusable.
          // BOUNDED, like every other text-returning tool. The only ceiling on a skill body is
          // `MAX_SKILL_MARKDOWN_BYTES` (1 MiB) at load time, so one `get` could inject ~250k tokens of
          // context in a single call — with no notice that anything was large and no way to page it —
          // while `read`, `search`, and `tool_output` all cap at 64 KB with a numbered
          // marker. The head is what matters in a skill (its instructions lead), so this truncates the
          // TAIL and points at the file, which the model can `read` with an offset.
          const capped = truncateHead(body, { maxBytes: MAX_OUTPUT_BYTES })
          const bodyOut = capped.truncated
            ? `${capped.content}\n${truncationMarker(capped, {
                kept: 'first',
                advice: `Long skill — read the rest from ${skill.path} with \`read\` (offset/start_line).`,
              })}`
            : body
          return {
            content: [
              `# Skill: ${skill.name}`,
              `Source: ${JSON.stringify(skill.path)}`,
              `Resolve relative references from: ${JSON.stringify(skill.dir)}`,
              '',
              bodyOut,
            ].join('\n'),
          }
        }

        case 'list': {
          const skills = await allSkills()
          if (skills.length === 0) return { content: 'No skills found.' }
          return {
            content: skills.map((s) => `- /${s.name} (${s.scope}): ${s.description}`).join('\n'),
          }
        }

        case 'delete': {
          if (!input.name)
            return { content: 'name is required for action="delete".', isError: true }
          // A disabled skill is absent from the model's capability surface. Do not
          // let a guessed name bypass that policy through a mutating action.
          if (isSkillDisabled(skillOverrides, input.name)) {
            return { content: `Skill not found: "${input.name}".`, isError: true }
          }
          const deleted = await deleteSkillByName(projectBase, input.name)
          if (deleted) {
            announce()
            return { content: `Skill deleted: "${input.name}"` }
          }
          if (extraSkills.some((s) => s.name === input.name)) {
            return {
              content: `Skill "${input.name}" is plugin-provided and read-only — disable the plugin to remove it.`,
              isError: true,
            }
          }
          return { content: notFoundMessage(input.name, await allSkills()), isError: true }
        }
      }
      // Name the valid ones: "unknown action" alone left the model to guess the vocabulary.
      return {
        content: `Unknown action "${String(input.action)}". Use one of: save, get, list, delete.`,
        isError: true,
      }
    },
  })
}
