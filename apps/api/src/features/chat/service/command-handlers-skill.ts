import { sessionRoute } from '../../../contracts/session-route'
import { recordSkillUse } from '../../agent-core/skill-usage-recorder'
import { announceSessionActive } from '../../agent-core/session-activity'
import { resolveDeclaredReasoningEffort } from '../../../db/types'
import type { MessageBinding } from '@localixai/agent'
import type { SessionSkill } from '@rsaryev/llx-plugin'
import {
  invokeTypedSkills,
  isPluginCommand,
  resolveModelAlias,
  skillPlugin,
  projectOrGlobal,
  typedSkills,
} from '../../plugins/kit'
import { attachFileReferences } from '../file-references'
import { resolveMessageBindings } from './message-bindings'
import { commandFolder } from './command-folder'
import { parseSkillCommand } from './slash-commands'
import { typedSkillShellAnswer } from './skill-command-authorize'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import { skillPrompt } from '../../mods/conversation-events'
import type { CommandHandlerContext } from './command-handlers-context'
import { isSkillDisabled } from '../../agent-core/skill-overrides'

/**
 * Handles user skill slash commands (`/<skill-name>`). A `/name` that isn't a built-in and that
 * the chat's kit session reads as a skill (its names, Claude Code's) runs the agent with the skill
 * as the session expands it (Claude Code: `user-invocable`, arguments, `${CLAUDE_*}`, its
 * `!` commands against the agent's rules, the skills stacked after it, its fork, model and
 * effort; its frontmatter `hooks` register on the session for the rest of it). A typed command is
 * a skill too (Claude Code: `.claude/commands/*.md` and a plugin's `commands/*.md`), run the same
 * way. The files the text names with `@` are attached from inside the working folder (and the
 * skill's own folder), and the context the person attached to the send reaches the turn. Returns
 * null when the prompt isn't a skill command, the kit has no skill by the name, `claims` leaves it
 * to a later handler or the agent's capability rules turn it off; the final unresolved-slash gate
 * then reports command-shaped input that no dynamic handler claimed.
 */
export async function handleSkillCommand(
  ctx: CommandHandlerContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
  /** Context refs the user attached to this send, resolved as every message's are. */
  bindings?: MessageBinding[],
  /** Which skills this call runs; absent, every one. */
  claims?: (skill: SessionSkill) => boolean,
): Promise<MessageMutationResponse | null> {
  const { repo, now, runMacroCommand, spawnForkSkill, insertDirectReply } = ctx

  if (!parseSkillCommand(prompt)) return null
  const kitSession = await ctx.chatPluginSession?.(userId, session)
  if (!kitSession) return null
  const signal = AbortSignal.timeout(10 * 60_000)
  // The skill folders read again first: a skill written since is a skill.
  await kitSession.reloadSkills({ signal })
  const named = typedSkills(kitSession, prompt)
  const [skill] = named.leading
  // No skill by the name — let the final unresolved-slash gate report it.
  if (!skill || (claims && !claims(skill))) return null
  const name = skill.invocable.command
  const scope = projectOrGlobal(skill)
  // The skill's plugin, for a forked child's hooks (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`).
  const plugin = skillPlugin(skill)
  const skillOverrides = await ctx.loadSkillOverrides(
    userId,
    session.projectId,
    named.leading.map((one) => one.invocable.command),
  )
  if (named.leading.some((one) => isSkillDisabled(skillOverrides, one.invocable.command)))
    return null
  const fail = (reason: string) =>
    insertDirectReply(userId, sessionId, prompt, `Skill \`/${name}\`: ${reason}`, now(), 'error')

  // No busy refusal: a skill command sent while the session works waits in the queue whole
  // (`run-macro.ts`), like every other slash command.
  const workingDir = await commandFolder(ctx, userId, session)
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
  const bases = [workingDir, ...(skill.directory ? [skill.directory] : [])]
  const texts = await Promise.all(
    typed.skills.map((one) => attachFileReferences(one.text, one.references, bases)),
  )
  const expanded = texts.join('\n\n')
  const arg = named.arguments
  // Claude Code mods' `skill.prompt`: the text the model reads for the skill.
  const instruction = await skillPrompt(
    ctx.deps?.mods,
    { userId, sessionId, cwd: workingDir },
    name,
    expanded,
    {
      scope,
      ...(skill.file ? { path: skill.file } : {}),
      ...(plugin ? { pluginName: plugin.name } : {}),
    },
  )
  // Curator usage telemetry — a slash-command invocation counts as a use. The curator tends the
  // person's own skills; a plugin's are the plugin's.
  if (!plugin) recordSkillUse(name, scope, scope === 'project' ? (session.projectId ?? '') : '')
  // The session recorded the skill: a plugin monitor waiting for it starts now.
  announceSessionActive({ userId, chatId: session.rootSessionId ?? sessionId, sessionId })

  // CC `context: fork` — run the skill in a child session, started as the invoking agent and run
  // as the agent the expansion names.
  if (first.fork && spawnForkSkill) {
    const { hooks } = skill.invocable
    const childId = await spawnForkSkill(userId, sessionId, instruction, {
      agent: first.fork.agent,
      title: `/${name}${arg ? ' ' + arg : ''}`,
      // CC skill frontmatter `hooks` — activated for the forked sub-agent run.
      ...(hooks ? { hooks, ...(plugin ? { hooksPlugin: plugin } : {}) } : {}),
    })
    return insertDirectReply(
      userId,
      sessionId,
      prompt,
      `Skill \`/${name}\` started in a fork (session \`${childId.slice(0, 8)}…\`). Results will appear in the runtime panel.`,
      now(),
    )
  }

  const grants = typed.skills.flatMap((one) => one.grants)
  const disallowed = typed.skills.flatMap((one) => one.disallowed)
  const effort = resolveDeclaredReasoningEffort(first.effort)
  const resolvedBindings = await resolveMessageBindings(ctx.deps, userId, session, bindings)
  // A plugin's command is the plugin's (`/<plugin>:<name>`); the rest are the person's skills.
  const kind = isPluginCommand(skill)
    ? ({ source: 'plugin', kind: 'plugin-command' } as const)
    : ({ source: 'slash', kind: 'skill' } as const)
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
      ...(resolvedBindings?.length ? { bindings: resolvedBindings } : {}),
      invocation: {
        source: kind.source,
        invocation: {
          kind: kind.kind,
          name,
          ...(arg ? { arguments: arg } : {}),
          lifetime: 'turn',
        },
        presentation: { label: `/${name}`, token: `/${name}` },
      },
    },
  )
}
