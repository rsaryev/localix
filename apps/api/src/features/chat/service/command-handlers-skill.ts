import { sessionRoute } from '../../../contracts/session-route'
import { recordSkillUse } from '../../agent-core/skill-usage-recorder'
import { announceSkillInvoked } from '../../agent-core/skill-invocations'
import { resolveModelAlias } from '../../agent-core/model-alias'
import { resolveDeclaredReasoningEffort } from '../../../db/types'
import { parseSkillCommand } from './slash-commands'
import { commandTarget } from './command-participant'
import { SkillCommandFailedError } from './skill-commands'
import { renderSkillBody } from './skill-render'
import { stackedSkills } from './command-handlers-skill-stack'
import { skillPromptDetails } from '../../agent-core/skill-prompt-details'
import {
  skillToolPathVars,
  substituteToolPathVars,
  toolOverrideOptions,
} from './tool-override-options'
import { authorizeTypedSkillCommands } from './skill-command-authorize'
import type { SessionRecord } from '../repository'
import type { SkillRecord } from './skills'
import { pluginDataDir } from '../../plugins/mcp'
import { userHome } from '../../../lib/env'
import type { MessageMutationResponse } from '../contracts'
import { skillPrompt } from '../../mods/conversation-events'
import type { CommandHandlerContext } from './command-handlers-context'
import { errorMessage } from '../../../lib/errors'
import { filterDisabledSkills } from '../../agent-core/skill-overrides'
import { roleNameOfSubagentType } from '../../ext/cc-agent-selection'

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

/**
 * Handles user skill slash commands (`/<skill-name>`). Saved skills surface as
 * slash commands; a `/name` that isn't a built-in and matches a stored skill
 * runs the agent with the skill's template. Returns null when the prompt isn't
 * a skill command OR no matching skill exists; the final unresolved-slash gate
 * then reports command-shaped input that no dynamic handler claimed.
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
  if (!skill) {
    // No matching skill — let the final unresolved-slash gate report it.
    return null
  }
  if (skill.userInvocable === false) {
    // CC `user-invocable: false` — model-only skill. It exists, so reporting
    // the final generic "Unknown slash command" is actively misleading.
    return insertDirectReply(
      userId,
      sessionId,
      prompt,
      'Skill `/' +
        skill.name +
        '` is model-only (`user-invocable: false`) and cannot be run as a slash command.',
      now(),
      'error',
    )
  }
  // No busy refusal: a skill command sent while the session works waits in the queue whole
  // (`run-macro.ts`), like every other slash command.
  // The participant the person is talking to answers the skill — its effort, its fork.
  const speaker = (
    await commandTarget(
      session,
      () => repo.listMessages(userId, sessionId),
      '',
      ctx.runner.leadership(userId, session.projectId),
    )
  )?.participant
  const workingDir = await ctx.resolveSessionWorkingDir(userId, session)
  // A plugin's skill is a plugin component: its `!cmd` lines and its frontmatter `hooks` both get
  // the plugin's `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}`, as Claude Code gives them.
  const plugin =
    skill.pluginName && skill.pluginDir
      ? {
          name: skill.pluginName,
          root: skill.pluginDir,
          dataDir: skill.pluginDataDir ?? pluginDataDir(skill.pluginName, userHome()),
        }
      : undefined
  const speakerRoute = speaker ?? sessionRoute(session)
  // CC rendering: `!cmd` and ```! blocks run (seeing the arguments), `@path` references inline,
  // then arguments and `${CLAUDE_*}` substitute. SECURITY: commands and @refs only for SKILL.md
  // files (source='file'): the user's own, and an ENABLED plugin's — Claude Code runs a plugin
  // skill's commands too. A failed command aborts the invocation before the model is asked.
  // The agent's rules, which every injected command meets first (`skill-command-authorize.ts`).
  const rules = await ctx.loadSkillCommandRules?.(userId, speakerRoute.agentId)
  const pathVars = skillToolPathVars({
    projectDir: workingDir,
    path: skill.path,
    pluginRoot: plugin?.root,
    pluginDataDir: plugin?.dataDir,
  })
  // `/write-tests /fix-issue 123`: the skills stacked after an inline first one, all taking `123`.
  const stack = skill.contextFork
    ? { extra: [], arg: skillCmd.arg }
    : await stackedSkills(
        skillCmd.arg,
        async (name) =>
          skills.find((s) => s.name.toLowerCase() === name) ??
          findPluginSkill(await ctx.gatherEnabledPluginSkills(userId, session), name),
      )
  const arg = stack.arg
  const render = (one: SkillRecord) =>
    renderSkillBody(one, arg, {
      ...(rules
        ? {
            authorize: authorizeTypedSkillCommands(
              rules,
              substituteToolPathVars(one.allowedTools, pathVars),
              workingDir,
            ),
          }
        : {}),
      sessionId,
      workingDir,
      effort: speakerRoute.reasoningEffort ?? 'low',
      ...(plugin
        ? { env: { CLAUDE_PLUGIN_ROOT: plugin.root, CLAUDE_PLUGIN_DATA: plugin.dataDir } }
        : {}),
      dynamic: one.source === 'file',
    })
  let expanded: string
  try {
    expanded = (await Promise.all([skill, ...stack.extra].map(render))).join('\n\n')
  } catch (error) {
    const reason =
      error instanceof SkillCommandFailedError
        ? error.message.slice(0, 4000)
        : `could not be loaded: ${errorMessage(error).slice(0, 500)}`
    return insertDirectReply(
      userId,
      sessionId,
      prompt,
      `Skill \`/${skill.name}\`: ${reason}`,
      now(),
      'error',
    )
  }
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

  // CC `context: fork` — run the skill in a child session, seated by the invoking agent and run
  // as the subagent type its `agent:` names (a plugin agent; general-purpose when omitted).
  if (skill.contextFork && spawnForkSkill) {
    const forkAgent = roleNameOfSubagentType(skill.forkAgent)
    const childId = await spawnForkSkill(userId, sessionId, instruction, {
      ...(speaker ? { invokedBy: speaker.agentId } : {}),
      ...(forkAgent ? { pluginAgent: forkAgent } : {}),
      title: `/${skill.name}${arg ? ' ' + arg : ''}`,
      preferredModel: skill.preferredModel,
      preferredEffort: skill.preferredEffort,
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

  return runMacroCommand(
    userId,
    sessionId,
    session,
    () => repo.listMessages(userId, sessionId),
    prompt,
    instruction,
    now(),
    {
      // CC disallowed-tools removes tools; allowed-tools auto-approves them.
      // ${CLAUDE_PROJECT_DIR} in allowed-tools resolves to the session working dir.
      ...toolOverrideOptions(
        {
          allowedTools: [skill, ...stack.extra].flatMap((s) => s.allowedTools ?? []),
          disallowedTools: [skill, ...stack.extra].flatMap((s) => s.disallowedTools ?? []),
        },
        pathVars,
      ),
      // CC skill frontmatter `hooks` — registered for "the rest of the session once the skill is
      // invoked": from this run on, every later run of the session keeps them. No
      // Stop→SubagentStop conversion: the skill runs in THIS session's turn.
      ...(skill.hooks
        ? {
            ccScopedHooks: [
              {
                raw: skill.hooks,
                source: 'skill' as const,
                lifetime: 'session' as const,
                ...(plugin ? { plugin } : {}),
              },
            ],
          }
        : {}),
      // CC skill `model:` — "applies for the rest of the current turn"; the next prompt runs on
      // the session model again. An alias resolves like a command's; `inherit` keeps the model.
      ...(skill.preferredModel
        ? { modelId: resolveModelAlias(skill.preferredModel, speakerRoute.modelId ?? undefined) }
        : {}),
      // CC skill `effort:` — the invoking turn's effort; an unknown value keeps the session's.
      ...(resolveDeclaredReasoningEffort(skill.preferredEffort)
        ? { reasoningEffort: resolveDeclaredReasoningEffort(skill.preferredEffort) }
        : {}),
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
