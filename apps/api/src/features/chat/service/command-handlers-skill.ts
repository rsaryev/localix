import { sessionRoute } from '../../../contracts/session-route'
import { recordSkillUse } from '../../agent-core/skill-usage-recorder'
import { announceSkillInvoked } from '../../agent-core/skill-invocations'
import { resolveModelAlias } from '../../agent-core/model-alias'
import { resolveDeclaredReasoningEffort } from '../../../db/types'
import { invokeTypedSkills } from '../../plugins/kit'
import { parseSkillCommand } from './slash-commands'
import { skillPromptDetails } from '../../agent-core/skill-prompt-details'
import { typedSkillShellAnswer } from './skill-command-authorize'
import type { SessionRecord } from '../repository'
import type { SkillRecord } from './skills'
import { pluginDataDir } from '../../plugins/mcp'
import { userHome } from '../../../lib/env'
import type { MessageMutationResponse } from '../contracts'
import { skillPrompt } from '../../mods/conversation-events'
import type { CommandHandlerContext } from './command-handlers-context'
import { filterDisabledSkills } from '../../agent-core/skill-overrides'

/**
 * A plugin skill by the name typed: `<plugin>:<skill>`, or the bare `<skill>` when exactly one
 * enabled plugin has it — Claude Code runs a plugin skill bare unless another command takes the
 * name, and every other kind of command was already tried before this one.
 */
export function findPluginSkill(
  skills: readonly SkillRecord[],
  typed: string,
): SkillRecord | undefined {
  const exact = skills.find((s) => s.name.toLowerCase() === typed)
  if (exact || typed.includes(':')) return exact
  const bare = skills.filter(
    (s) => s.pluginName && s.name.slice(s.pluginName.length + 1).toLowerCase() === typed,
  )
  return bare.length === 1 ? bare[0] : undefined
}

/** The skill's plugin, for a forked child's hooks (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`). */
function pluginOf(skill: SkillRecord) {
  if (!skill.pluginName || !skill.pluginDir) return undefined
  return {
    name: skill.pluginName,
    root: skill.pluginDir,
    dataDir: skill.pluginDataDir ?? pluginDataDir(skill.pluginName, userHome()),
  }
}

/**
 * Handles user skill slash commands (`/<skill-name>`). Saved skills surface as slash commands; a
 * `/name` that isn't a built-in and matches a listed skill runs the agent with the skill as the
 * chat's kit session expands it (Claude Code: `user-invocable`, arguments, `${CLAUDE_*}`, its
 * `!` commands against the agent's rules, the skills stacked after it, its fork, model and
 * effort; its frontmatter `hooks` register on the session for the rest of it). Returns null when
 * the prompt isn't a skill command OR no listed skill has the name; the final unresolved-slash
 * gate then reports command-shaped input that no dynamic handler claimed.
 */
export async function handleSkillCommand(
  ctx: CommandHandlerContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
): Promise<MessageMutationResponse | null> {
  const { repo, now, runMacroCommand, gatherSessionSkills, spawnForkSkill, insertDirectReply } = ctx

  const skillCmd = parseSkillCommand(prompt)
  if (!skillCmd) return null

  const discoveredSkills = await gatherSessionSkills(userId, session)
  const skillOverrides = await ctx.loadSkillOverrides(
    userId,
    session.projectId,
    discoveredSkills.map((s) => s.name),
  )
  const skills = filterDisabledSkills(discoveredSkills, skillOverrides)
  const skill =
    skills.find((s) => s.name.toLowerCase() === skillCmd.name) ??
    findPluginSkill(await ctx.gatherEnabledPluginSkills(userId, session), skillCmd.name)
  // No matching skill — let the final unresolved-slash gate report it.
  if (!skill) return null
  const fail = (reason: string) =>
    insertDirectReply(
      userId,
      sessionId,
      prompt,
      `Skill \`/${skill.name}\`: ${reason}`,
      now(),
      'error',
    )

  // No busy refusal: a skill command sent while the session works waits in the queue whole
  // (`run-macro.ts`), like every other slash command.
  const workingDir = await ctx.resolveSessionWorkingDir(userId, session)
  const kitSession = await ctx.chatPluginSession?.(userId, session)
  if (!kitSession) return fail('skills run in a chat of the plugin host, and this one has none.')
  const route = sessionRoute(session)
  // The agent's rules, which every injected command meets first; absent, the kit's own rules.
  const rules = await ctx.loadSkillCommandRules?.(userId, route.agentId)
  const typed = await invokeTypedSkills(kitSession, prompt, {
    signal: AbortSignal.timeout(10 * 60_000),
    ...(rules ? { shellPermission: typedSkillShellAnswer(rules, workingDir) } : {}),
  })
  if (!typed.ok) return fail(typed.message.slice(0, 4000))
  const [first] = typed.skills
  if (!first) return fail("this chat's plugin session does not list it.")
  const expanded = typed.skills.map((one) => one.text).join('\n\n')
  const arg = skillCmd.arg
  // Claude Code mods' `skill.prompt`: the text the model reads for the skill.
  const instruction = await skillPrompt(
    ctx.deps?.mods,
    { userId, sessionId, cwd: workingDir },
    skill.name,
    expanded,
    await skillPromptDetails(skill),
  )
  // Curator usage telemetry — a slash-command invocation counts as a use. The curator tends the
  // person's own skills; a plugin's are the plugin's.
  if (!skill.pluginName)
    recordSkillUse(
      skill.name,
      skill.scope,
      skill.scope === 'project' ? (session.projectId ?? '') : '',
    )
  // A plugin monitor waiting for this skill starts now (`on-skill-invoke:<skill>`).
  announceSkillInvoked({
    userId,
    sessionId: session.rootSessionId ?? sessionId,
    ...(skill.pluginName
      ? { skillName: skill.name.slice(skill.pluginName.length + 1), pluginName: skill.pluginName }
      : { skillName: skill.name }),
    ...(workingDir ? { cwd: workingDir } : {}),
  })

  // CC `context: fork` — run the skill in a child session, started as the invoking agent and run
  // as the agent the expansion names.
  if (first.fork && spawnForkSkill) {
    const plugin = pluginOf(skill)
    const childId = await spawnForkSkill(userId, sessionId, instruction, {
      agent: first.fork.agent,
      title: `/${skill.name}${arg ? ' ' + arg : ''}`,
      // CC skill frontmatter `hooks` — activated for the forked sub-agent run.
      ...(skill.hooks ? { hooks: skill.hooks, ...(plugin ? { hooksPlugin: plugin } : {}) } : {}),
    })
    return insertDirectReply(
      userId,
      sessionId,
      prompt,
      `Skill \`/${skill.name}\` started in a fork (session \`${childId.slice(0, 8)}…\`). Results will appear in the runtime panel.`,
      now(),
    )
  }

  const grants = typed.skills.flatMap((one) => one.grants)
  const disallowed = typed.skills.flatMap((one) => one.disallowed)
  const effort = resolveDeclaredReasoningEffort(first.effort)
  return runMacroCommand(
    userId,
    sessionId,
    session,
    () => repo.listMessages(userId, sessionId),
    prompt,
    instruction,
    now(),
    {
      // CC disallowed-tools removes tools; allowed-tools auto-approves them (paths filled by the kit).
      ...(grants.length ? { extraAllowedTools: grants } : {}),
      ...(disallowed.length ? { extraDisabledTools: disallowed } : {}),
      // CC skill `model:` — "applies for the rest of the current turn"; the next prompt runs on
      // the session model again. An alias resolves to the catalog's model.
      ...(first.model
        ? { modelId: resolveModelAlias(first.model, route.modelId ?? undefined) }
        : {}),
      // CC skill `effort:` — the invoking turn's effort; an unknown value keeps the session's.
      ...(effort ? { reasoningEffort: effort } : {}),
      invocation: {
        source: 'slash',
        invocation: {
          kind: 'skill',
          name: skill.name,
          ...(arg ? { arguments: arg } : {}),
          lifetime: 'turn',
        },
        presentation: { label: `/${skill.name}`, token: `/${skill.name}` },
      },
    },
  )
}
