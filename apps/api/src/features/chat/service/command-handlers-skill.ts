import { sessionRoute } from '../../../contracts/session-route'
import { dirname } from 'node:path'
import { recordSkillUse } from '../../agent-core/skill-usage-recorder'
import { announceSkillInvoked } from '../../agent-core/skill-invocations'
import { parseSkillCommand, applySkillArguments } from './slash-commands'
import { commandTarget } from './command-participant'
import { expandSkillContent } from './skill-commands'
import { expandFileReferences } from './file-references'
import { toolOverrideOptions } from './tool-override-options'
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
  let rawSkillContent: string
  try {
    rawSkillContent = skill.content
  } catch (error) {
    return insertDirectReply(
      userId,
      sessionId,
      prompt,
      `Skill \`/${skill.name}\` could not be loaded: ${errorMessage(error).slice(0, 500)}`,
      now(),
      'error',
    )
  }
  // CC dynamic context injection: !`cmd` and ```!\n...\n``` blocks are pre-expanded
  // before argument substitution so command output can reference $ARGUMENTS etc.
  // SECURITY: only expand for SKILL.md files (source='file'): the user's own, and an ENABLED
  // plugin's — Claude Code runs a plugin skill's commands too, as `/<plugin>:<command>` already
  // does here.
  const workingDir = await ctx.resolveSessionWorkingDir(userId, session)
  // A plugin's skill is a plugin component: its `!cmd` lines and its frontmatter `hooks` both get
  // the plugin's `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}`, as Claude Code gives them.
  const plugin =
    skill.pluginName && skill.pluginDir
      ? {
          name: skill.pluginName,
          root: skill.pluginDir,
          dataDir: pluginDataDir(skill.pluginName, userHome()),
        }
      : undefined
  // Inject CC skill env vars so !`cmd` scripts can reference them.
  const skillEnv: Record<string, string> = {
    CLAUDE_SESSION_ID: sessionId,
    CLAUDE_EFFORT: (speaker ?? sessionRoute(session)).reasoningEffort ?? 'low',
    CLAUDE_PROJECT_DIR: workingDir,
    ...(skill.path ? { CLAUDE_SKILL_DIR: dirname(skill.path) } : {}),
    ...(plugin ? { CLAUDE_PLUGIN_ROOT: plugin.root, CLAUDE_PLUGIN_DATA: plugin.dataDir } : {}),
  }
  // CC @path file references — inline referenced file content after !`cmd` expansion.
  // SECURITY: only for filesystem skills (source='file'); plugin/MCP/remote bodies are
  // never scanned for @refs. Bases: the session working dir + the skill's own dir (so a
  // skill can reference its bundled `@reference.md`), both confinement-gated.
  const expandedContent =
    skill.source === 'file'
      ? await expandFileReferences(
          await expandSkillContent(rawSkillContent, workingDir, skillEnv),
          [workingDir, ...(skill.path ? [dirname(skill.path)] : [])],
        )
      : rawSkillContent
  const expanded = applySkillArguments(expandedContent, skillCmd.arg, {
    argumentNames: skill.argumentNames,
    skillDir: skill.path ? dirname(skill.path) : undefined,
    sessionId,
    effort: (speaker ?? sessionRoute(session)).reasoningEffort ?? 'low',
    projectDir: workingDir,
  })
  // Claude Code mods' `skill.prompt`: the text the model reads for the skill.
  const instruction = await skillPrompt(
    ctx.deps?.mods,
    { userId, sessionId, cwd: workingDir },
    skill.name,
    expanded,
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
  })

  // CC `context: fork` — run the skill in a child session, as the invoking agent itself.
  if (skill.contextFork && spawnForkSkill) {
    // `agent:` used to start a different agent for the skill. No path starts another agent on a
    // skill's behalf any more, so the declaration is ignored — and said so, not silently.
    const ignoredAgent = roleNameOfSubagentType(skill.forkAgent)
    if (ignoredAgent) {
      console.warn(
        `[skill-fork] /${skill.name}: "agent: ${ignoredAgent}" is no longer honoured; the skill runs as the invoking agent.`,
      )
    }
    const childId = await spawnForkSkill(userId, sessionId, instruction, {
      ...(speaker ? { invokedBy: speaker.agentId } : {}),
      title: `/${skill.name}${skillCmd.arg ? ' ' + skillCmd.arg : ''}`,
      preferredModel: skill.preferredModel,
      preferredEffort: skill.preferredEffort,
      // CC skill frontmatter `hooks` — activated for the forked sub-agent run.
      ...(skill.hooks ? { hooks: skill.hooks, ...(plugin ? { hooksPlugin: plugin } : {}) } : {}),
    })
    return insertDirectReply(
      userId,
      sessionId,
      prompt,
      `Skill \`/${skill.name}\` started in a fork (session \`${childId.slice(0, 8)}…\`). Results will appear in the runtime panel.${
        ignoredAgent
          ? ` Its \`agent: ${ignoredAgent}\` is no longer honoured: the fork runs as the invoking agent.`
          : ''
      }`,
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
      ...toolOverrideOptions(skill, workingDir),
      // CC skill frontmatter `hooks` — active for this (inline) skill run only. No
      // Stop→SubagentStop conversion: the skill runs in THIS session's turn, so its
      // `Stop` hooks fire on this run's stop, exactly when the skill is done.
      ...(skill.hooks
        ? {
            ccScopedHooks: [
              { raw: skill.hooks, source: 'skill' as const, ...(plugin ? { plugin } : {}) },
            ],
          }
        : {}),
      invocation: {
        source: 'slash',
        invocation: {
          kind: 'skill',
          name: skill.name,
          ...(skillCmd.arg ? { arguments: skillCmd.arg } : {}),
          lifetime: 'turn',
        },
        presentation: { label: `/${skill.name}`, token: `/${skill.name}` },
      },
    },
  )
}
