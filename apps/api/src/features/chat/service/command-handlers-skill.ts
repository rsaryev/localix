import { sessionRoute } from '../../../contracts/session-route'
import { recordSkillUse } from '../../agent-core/skill-usage-recorder'
import { announceSkillInvoked } from '../../agent-core/skill-invocations'
import { resolveModelAlias } from '../../agent-core/model-alias'
import { resolveDeclaredReasoningEffort } from '../../../db/types'
import {
  invokeTypedSkills,
  reloadSessionSkills,
  typedSkills,
  type ChatSkill,
} from '../../plugins/kit'
import { parseSkillCommand } from './slash-commands'
import { skillPromptDetails } from '../../agent-core/skill-prompt-details'
import { typedSkillShellAnswer } from './skill-command-authorize'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import { skillPrompt } from '../../mods/conversation-events'
import type { CommandHandlerContext } from './command-handlers-context'
import { isSkillDisabled } from '../../agent-core/skill-overrides'

/** The skill's plugin, for a forked child's hooks (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`). */
function pluginOf(skill: ChatSkill) {
  return skill.plugin ? { id: skill.plugin.id, name: skill.plugin.name } : undefined
}

/**
 * Handles user skill slash commands (`/<skill-name>`). A `/name` that isn't a built-in and that
 * the chat's kit session reads as a skill (its names, Claude Code's) runs the agent with the skill
 * as the session expands it (Claude Code: `user-invocable`, arguments, `${CLAUDE_*}`, its
 * `!` commands against the agent's rules, the skills stacked after it, its fork, model and
 * effort; its frontmatter `hooks` register on the session for the rest of it). Returns null when
 * the prompt isn't a skill command, the kit has no skill by the name or the agent's capability
 * rules turn it off; the final unresolved-slash
 * gate then reports command-shaped input that no dynamic handler claimed.
 */
export async function handleSkillCommand(
  ctx: CommandHandlerContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
): Promise<MessageMutationResponse | null> {
  const { repo, now, runMacroCommand, spawnForkSkill, insertDirectReply } = ctx

  if (!parseSkillCommand(prompt)) return null
  const kitSession = await ctx.chatPluginSession?.(userId, session)
  if (!kitSession) return null
  const signal = AbortSignal.timeout(10 * 60_000)
  // The skill folders read again first: a skill written since is a skill.
  await reloadSessionSkills(kitSession, signal)
  const named = typedSkills(kitSession, prompt)
  const [skill] = named.leading
  // No skill by the name — let the final unresolved-slash gate report it.
  if (!skill) return null
  const skillOverrides = await ctx.loadSkillOverrides(
    userId,
    session.projectId,
    named.leading.map((one) => one.name),
  )
  if (named.leading.some((one) => isSkillDisabled(skillOverrides, one.name))) return null
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
  const route = sessionRoute(session)
  // The agent's rules, which every injected command meets first; absent, the kit's own rules.
  const rules = await ctx.loadSkillCommandRules?.(userId, route.agentId)
  const typed = await invokeTypedSkills(kitSession, prompt, {
    signal,
    ...(rules ? { shellPermission: typedSkillShellAnswer(rules, workingDir) } : {}),
  })
  if (!typed.ok) return fail(typed.message.slice(0, 4000))
  const [first] = typed.skills
  if (!first) return fail("this chat's plugin session does not list it.")
  const expanded = typed.skills.map((one) => one.text).join('\n\n')
  const arg = named.arguments
  // Claude Code mods' `skill.prompt`: the text the model reads for the skill.
  const instruction = await skillPrompt(
    ctx.deps?.mods,
    { userId, sessionId, cwd: workingDir },
    skill.name,
    expanded,
    await skillPromptDetails({
      scope: skill.scope,
      ...(skill.path ? { path: skill.path } : {}),
      ...(skill.plugin ? { pluginName: skill.plugin.name } : {}),
    }),
  )
  // Curator usage telemetry — a slash-command invocation counts as a use. The curator tends the
  // person's own skills; a plugin's are the plugin's.
  if (!skill.plugin)
    recordSkillUse(
      skill.name,
      skill.scope,
      skill.scope === 'project' ? (session.projectId ?? '') : '',
    )
  // A plugin monitor waiting for this skill starts now (`on-skill-invoke:<skill>`).
  announceSkillInvoked({
    userId,
    sessionId: session.rootSessionId ?? sessionId,
    skillName: skill.ownName,
    ...(skill.plugin ? { pluginName: skill.plugin.name } : {}),
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
