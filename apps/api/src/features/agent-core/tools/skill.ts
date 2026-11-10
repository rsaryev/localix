import { truncateHead } from '@localixai/agent'
import { errorMessage } from '../../../lib/errors'
import { homedir } from 'node:os'
import { defineAgentTool } from '@localixai/agent/agents'
import { TOOL } from '../tool-names'
import { discoverFilesystemSkills, writeSkillFile, type DiscoveredSkill } from '../skill-discovery'
import { recordSkillUse } from '../skill-usage-recorder'
import { skillPromptDetails } from '../skill-prompt-details'
import { ambiguousSkillNames, findSkillByName, skillCallName } from './skill-names'
import { MAX_OUTPUT_BYTES } from './file/read-output'
import { truncationMarker } from './tool-output'
import { filterDisabledSkills, isSkillDisabled, type SkillOverrides } from '../skill-overrides'
import {
  type SkillEntry,
  type SkillFound,
  classifySkillCall,
  skillPermissionResources,
  prepareSkillArguments,
  skillToolInputSchema,
  type SkillRun,
  type SkillToolPorts,
} from './skill-call'

export {
  classifySkillCall,
  skillPermissionResources,
  type SkillForkRequest,
  type SkillRun,
  type SkillToolPorts,
} from './skill-call'

/**
 * Filesystem-backed skill management. Skills are directories containing a
 * SKILL.md (plus any scripts/assets the agent adds with the write/bash tools).
 * They are discovered by walking up from `workingDir` and falling back to the
 * home dir — no database involved, so skills are portable and shippable.
 *
 * @param workingDir The session's project working dir, or null/'/' if none.
 * @param extraSkills Read-only skills contributed outside the filesystem scopes
 *   (e.g. plugin-bundled skills from `loadEnabledPlugins`). They are visible to
 *   `get` but cannot be saved over — saving always targets
 *   the filesystem scopes, and a filesystem skill of the same name wins.
 * @param skillOverrides User visibility policy. `off` removes a skill from every
 *   model-facing action, including guessed names.
 * @param projectId Exact project scope for usage telemetry. Empty means sessions
 *   without a project.
 * @param onSkillsChanged Host port, called after a `save` changed the skill set.
 *   A skill is a capability: it rides in the capability snapshot and in a run's
 *   "# Available skills", both of which are refreshed only when the capability revision moves.
 *   The tool wrote SKILL.md and announced nothing, so the Skills list stayed stale and the
 *   next run's prompt could omit what the agent had just saved — until an unrelated plugin
 *   or MCP toggle happened to bump the revision. Injected rather than imported: the
 *   announcement (bump + client poke) belongs to the host, not to agent-core.
 * @param ports Host ports: `invokeSkill` runs the skill as Claude Code does when Claude invokes it
 *   (who may invoke it, its arguments, `${CLAUDE_*}` variables and injected commands, its fork);
 *   its refusal is the result's error. Absent: the content as written.
 */
export function createSkillTool(
  workingDir?: string | null,
  extraSkills: DiscoveredSkill[] = [],
  skillOverrides: SkillOverrides = {},
  projectId = '',
  onSkillsChanged?: () => void,
  ports: SkillToolPorts = {},
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
  // in agent-runner: fileSkills before loadedPlugins.skills). Keyed by the name a skill is called
  // by, so two plugins' `lookup` stay two skills: `/a:lookup` and `/b:lookup`. The sort is for the
  // list only: `findSkillByName` matches a call name exactly before any bare plugin name.
  const allSkills = async (): Promise<DiscoveredSkill[]> => {
    const fileSkills = await discoverFilesystemSkills(projectBase)
    const byName = new Map<string, DiscoveredSkill>()
    for (const s of [...fileSkills, ...extraSkills]) {
      if (!byName.has(skillCallName(s))) byName.set(skillCallName(s), s)
    }
    return filterDisabledSkills([...byName.values()], skillOverrides).sort((a, b) =>
      skillCallName(a).localeCompare(skillCallName(b)),
    )
  }

  /** The skill a name calls on disk, when no host finds it (`ports.findSkill`). */
  const foundOnDisk = async (name: string): Promise<SkillFound> => {
    const skills = await allSkills()
    const found = findSkillByName(skills, name)
    return {
      ...(found ? { skill: entryOf(found) } : {}),
      names: skills.map(skillCallName),
      ambiguous: ambiguousSkillNames(skills, name),
    }
  }

  const notFoundMessage = (name: string, { names, ambiguous = [] }: SkillFound): string => {
    if (ambiguous.length > 0) {
      return `Skill name "${name}" is ambiguous: ${ambiguous.map((n) => `/${n}`).join(', ')}. Ask for one by its full name.`
    }
    if (names.length === 0) return `Skill not found: "${name}". No skills are available.`
    const shown = names.slice(0, 30)
    const more = names.length > shown.length ? ` (+${names.length - shown.length} more)` : ''
    return `Skill not found: "${name}". Available skills: ${shown.join(', ')}${more}`
  }
  return defineAgentTool({
    name: TOOL.Skill,
    label: 'Skill',
    activeVerb: 'Managing skill',
    // The skills that exist are listed in the prompt's "# Available skills"; searching and
    // removing them is the `Store` tool's.
    // The name case agrees with the `name` example below; the two used to disagree.
    description:
      'Save and get reusable skills (SKILL.md files; scripts/assets beside them via `Write`/`Bash`). After a non-trivial reusable workflow (a tricky fix, a multi-step procedure) save it under a kebab-case verb name; never save one-off answers, and fix a skill the moment it turns out wrong.',
    inputSchema: skillToolInputSchema,
    prepareArguments: prepareSkillArguments,
    permissionResources: skillPermissionResources,
    // `save` writes <base>/.claude/skills/<name>/SKILL.md. With `scope:"global"` the base is
    // homedir(), i.e. outside the workspace — which is exactly what the confirmation prompt
    // exists for.
    mutates: true,
    classify: classifySkillCall,
    executionMode: 'sequential',
    // get only reads, so it overlaps other reads; save stays a barrier in its turn.
    executionModeFor: (input) =>
      classifySkillCall(input).effect === 'read' ? 'parallel' : 'sequential',
    async execute(toolCallId, input, signal) {
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
              { projectId: isGlobal ? '' : projectId },
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
          const found = await (ports.findSkill?.(input.name, signal) ?? foundOnDisk(input.name))
          const names = found.names.filter((name) => !isSkillDisabled(skillOverrides, name))
          const skill =
            found.skill && !isSkillDisabled(skillOverrides, found.skill.name)
              ? found.skill
              : undefined
          if (!skill)
            return { content: notFoundMessage(input.name, { ...found, names }), isError: true }
          const called = skill.name
          const args = input.arguments ?? ''
          // Claude Code's refusal (`disable-model-invocation`: "do not reproduce the steps another
          // way") or the reason a command or the file failed.
          let run: SkillRun
          try {
            run = ports.invokeSkill
              ? await ports.invokeSkill(skill, {
                  arguments: args,
                  named: ports.userNamed?.(called) === true,
                  ...(signal ? { signal } : {}),
                })
              : { ok: true, text: skill.content ?? '' }
          } catch (error) {
            run = { ok: false, message: errorMessage(error) }
          }
          if (!run.ok) {
            return {
              content: `Skill "${called}" could not be loaded: ${run.message.slice(0, 4000)}`,
              isError: true,
            }
          }
          const body = run.text
          // Curator usage telemetry — best-effort, never blocks the get.
          recordSkillUse(skill.ownName, skill.scope, skill.scope === 'project' ? projectId : '')
          // CC `context: fork`: the expanded skill is a subagent's task, of the type it names.
          if (run.fork && ports.forkSkill) {
            const { agent, wait, model, effort } = run.fork
            return ports.forkSkill(toolCallId, {
              title: `/${called}${args.trim() ? ` ${args.trim()}` : ''}`.slice(0, 120),
              task: body,
              agent,
              wait,
              ...(model ? { model } : {}),
              ...(effort ? { effort } : {}),
            })
          }
          // Progressive loading must retain provenance: bundled scripts,
          // references, and assets are relative to the skill directory. Other
          // agents wrap explicit skill bodies with a baseDir or inject their
          // path; returning only the body makes those relative links unusable.
          // BOUNDED, like every other text-returning tool. The only ceiling on a skill body is
          // `MAX_SKILL_MARKDOWN_BYTES` (1 MiB) at load time, so one `get` could inject ~250k tokens of
          // context in a single call — with no notice that anything was large and no way to page it —
          // while `read`, `search`, and `ToolOutput` all cap at 64 KB with a numbered
          // marker. The head is what matters in a skill (its instructions lead), so this truncates the
          // TAIL and points at the file, which the model can `read` with an offset.
          const capped = truncateHead(body, { maxBytes: MAX_OUTPUT_BYTES })
          const bodyOut = capped.truncated
            ? `${capped.content}\n${truncationMarker(capped, {
                kept: 'first',
                advice: `Long skill — read the rest from ${skill.path} with \`Read\` (offset/start_line).`,
              })}`
            : body
          return {
            // What a mod's `skill.prompt` is told about the skill it rewrites.
            details: { skill: await skillPromptDetails(skill) },
            content: [
              `# Skill: ${called}`,
              `Source: ${JSON.stringify(skill.path)}`,
              `Resolve relative references from: ${JSON.stringify(skill.dir)}`,
              '',
              bodyOut,
            ].join('\n'),
          }
        }
      }
      // Name the valid ones: "unknown action" alone left the model to guess the vocabulary.
      return {
        content: `Unknown action "${String(input.action)}". Use one of: save, get. The Store lists and removes skills.`,
        isError: true,
      }
    },
  })
}

/** A skill found on disk, as a `get` uses it; its text is read when the `get` returns it. */
function entryOf(skill: DiscoveredSkill): SkillEntry {
  return {
    name: skillCallName(skill),
    ownName: skill.name,
    scope: skill.scope,
    path: skill.path,
    dir: skill.dir,
    ...(skill.pluginName ? { pluginName: skill.pluginName } : {}),
    get content() {
      return skill.content
    },
  }
}
