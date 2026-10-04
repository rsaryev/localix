import { sessionRoute } from '../session-route'
import { dirname } from 'node:path'
import { recordSkillUse } from '../../skills-curator/usage-recorder'
import { formatSessionUsageFromTurns } from './usage'
import {
  parseControlCommand,
  parseSkillCommand,
  parseSlashInvocation,
  applySkillArguments,
} from './slash-commands'
import { handleLoopControlCommand } from './command-handlers-loop'
import {
  handleHelpControlCommand,
  handleMemoryControlCommand,
  handleSkillsControlCommand,
  handleMcpControlCommand,
} from './command-handlers-listings'
import { handleMacroOrContextCommand } from './command-handlers-macros'
import { handleModelCommand, handleReasoningCommand } from './command-handlers-settings'
import { commandTarget } from './command-participant'
import { expandSkillContent } from './skill-commands'
import { expandFileReferences } from './file-references'
import { toolOverrideOptions } from './tool-override-options'
import { parsePluginCommandArgs, renderPluginPrompt } from './plugin-commands'
import type { MessageBinding } from '@localixai/agent'
import { resolveMessageBindings } from './message-bindings'
import { handlePluginsControlCommand } from './command-handlers-plugins'
import type { SessionRecord } from '../repository'
import { resolveModelAlias } from '../../agent-core/model-alias'
import { assertSessionNotBusy } from './session-access'
import type { MessageMutationResponse } from '../contracts'
import { BUSY_STOP_FIRST, type CommandHandlerContext } from './command-handlers-context'
import { readSessionUsageRows } from '../../usage/session-summary'
import { resolveCommandSpec, suggestCommands } from '../slash-catalog'
import { errorMessage } from '../../../lib/errors'
import { filterDisabledSkills } from '../../agent-core/skill-overrides'

// Re-export the handler-context surface so existing importers of
// './command-handlers' (the sibling handler modules + service.ts) are unchanged.
export {
  BUSY_STOP_FIRST,
  type CommandHandlerContext,
  type DirectReply,
} from './command-handlers-context'

/**
 * Handles the built-in control slash commands (/help, /usage, /model,
 * /reasoning, /memory, /skills, /mcp, /plugin, /provider, /init, /commit,
 * /review, /clear). Returns null when the prompt isn't a control
 * command — the caller falls through to the next dispatch stage.
 */
export async function handleControlCommand(
  ctx: CommandHandlerContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
): Promise<MessageMutationResponse | null> {
  const { repo, usageRepo, runner, now, insertDirectReply } = ctx

  const control = parseControlCommand(prompt)
  if (!control) return null

  const ts = now()
  const existingMessages = () => repo.listMessages(userId, sessionId)

  // Local shorthand: every direct reply in this handler shares the same
  // userId/sessionId/prompt/ts — only the text varies.
  const directReply = (text: string) => insertDirectReply(userId, sessionId, prompt, text, ts)

  if (control === 'help') {
    return handleHelpControlCommand(directReply, prompt)
  }

  if (control === 'usage') {
    const [turns, ledgerByKind] = await Promise.all([
      repo.getActiveBranchUsage(userId, sessionId),
      readSessionUsageRows(usageRepo, userId, sessionId),
    ])
    return directReply(formatSessionUsageFromTurns(turns, ledgerByKind))
  }

  if (control === 'model') {
    return handleModelCommand(
      ctx,
      userId,
      sessionId,
      session,
      existingMessages,
      prompt,
      ts,
      directReply,
    )
  }

  if (control === 'reasoning') {
    return handleReasoningCommand(
      ctx,
      userId,
      sessionId,
      session,
      existingMessages,
      prompt,
      ts,
      directReply,
    )
  }

  if (control === 'loop') {
    return handleLoopControlCommand(
      ctx,
      userId,
      sessionId,
      session,
      existingMessages,
      prompt,
      ts,
      directReply,
    )
  }

  if (control === 'memory') {
    return handleMemoryControlCommand(ctx, userId, session, prompt, ts, directReply)
  }

  if (control === 'skills') {
    return handleSkillsControlCommand(ctx, userId, session, directReply)
  }

  if (control === 'mcp') {
    return handleMcpControlCommand(ctx, userId, session, directReply)
  }

  if (control === 'plugins') {
    return handlePluginsControlCommand(ctx, userId, session, prompt, directReply)
  }

  // The remaining commands mutate context or run the agent — block while busy.
  assertSessionNotBusy(runner, sessionId, BUSY_STOP_FIRST)

  return handleMacroOrContextCommand(
    ctx,
    control,
    userId,
    sessionId,
    session,
    existingMessages,
    prompt,
    ts,
    directReply,
  )
}

/**
 * Handles namespaced plugin slash commands (`/<plugin>:<command>`). Plugins
 * declare their own slash-commands in their manifest; a namespaced token is
 * dispatched generically: parse positional args against the command's declared
 * `args`, render its `prompt` template, and run it as a macro. Nothing here
 * knows about any specific plugin. Returns null when the prompt's first token
 * isn't a namespaced command.
 *
 * Context refs attached to the send resolve through the SAME channel every message uses
 * (`resolveMessageBindings` → Context Fabric → model-only context assets).
 * Kind-agnostic: any `@session:`/`@project:`/`@message:`/`@snippet`/
 * `@resource:` (git·db·container·cluster·chat) link reaches the plugin command's model
 * turn exactly like it would any command invocation.
 */
export async function handlePluginCommand(
  ctx: CommandHandlerContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
  /** Context refs the user attached to this send. Expanded into model-only
   *  instruction attachments so a plugin command over an attached
   *  `@resource:localix://resource/git/…` can act on the linked node. */
  bindings?: MessageBinding[],
): Promise<MessageMutationResponse | null> {
  const { repo, now, deps, insertDirectReply, runMacroCommand, gatherEnabledPluginCommands } = ctx

  const firstToken = prompt.trim().split(/\s+/)[0] ?? ''
  // Accept the namespaced `/<plugin>:<command>` form, OR a bare `/<name>` which we
  // only treat as a plugin command when a plugin named `<name>` has a command also
  // named `<name>` (the redundant `<plugin>:<plugin>` case — collapsed for nicer UX,
  // e.g. `/feature-dev` instead of `/feature-dev:feature-dev`). A bare `/<name>` with
  // no same-name command falls through (return null) so skills/builtins still resolve.
  // The command part may itself be namespaced (`/<plugin>:<sub>:<cmd>` from a nested
  // `commands/<sub>/<cmd>.md`), so it captures one-or-more colon-joined segments.
  const tokenMatch = firstToken.match(/^\/([a-z0-9_-]+)(?::([a-z0-9_-]+(?::[a-z0-9_-]+)*))?$/i)
  if (!tokenMatch) return null
  const pluginName = tokenMatch[1].toLowerCase()
  const commandName = (tokenMatch[2] ?? tokenMatch[1]).toLowerCase()

  const ts = now()
  const argString = prompt.trim().slice(firstToken.length).trim()

  const available = await gatherEnabledPluginCommands(userId, session)
  const match = available.find(
    (c) => c.plugin.toLowerCase() === pluginName && c.command.name.toLowerCase() === commandName,
  )
  if (match) {
    // No busy refusal: a command sent while the session works waits in the queue whole
    // (`run-macro.ts`). The participant the person is talking to answers it.
    const speaker = (
      await commandTarget(
        session,
        () => repo.listMessages(userId, sessionId),
        '',
        ctx.runner.leadership(userId, session.projectId),
      )
    )?.participant
    const speakerRoute = speaker ?? sessionRoute(session)
    const parsed = parsePluginCommandArgs(match.command, argString, match.plugin)
    if ('usage' in parsed) {
      return insertDirectReply(userId, sessionId, prompt, parsed.usage, ts)
    }
    const projectDir = await ctx.resolveSessionWorkingDir(userId, session)
    const instruction = await renderPluginPrompt(match.command.prompt, parsed.values, argString, {
      sessionId,
      effort: speakerRoute.reasoningEffort ?? undefined,
      pluginDir: match.pluginDir,
      pluginName: match.plugin,
      projectDir,
      // CC dynamic content (`!\`cmd\``, `@path`) runs in the session working dir.
      cwd: projectDir,
    })
    const resolvedBindings = await resolveMessageBindings(deps, userId, session, bindings)
    return runMacroCommand(
      userId,
      sessionId,
      session,
      () => repo.listMessages(userId, sessionId),
      prompt,
      instruction,
      ts,
      {
        ...toolOverrideOptions(match.command, projectDir),
        ...(resolvedBindings?.length ? { bindings: resolvedBindings } : {}),
        invocation: {
          source: 'plugin',
          invocation: {
            kind: 'plugin-command',
            name: `${match.plugin}:${match.command.name}`,
            ...(argString ? { arguments: argString } : {}),
            lifetime: 'turn',
          },
          presentation: { label: `/${match.command.name}`, token: firstToken },
        },
        // CC command `model:` frontmatter → best-effort per-run model override.
        // May be an alias (`sonnet`/`opus`/`inherit`) — resolve it like agent/skill
        // `model:` values; `inherit`/unresolved falls back to the session model,
        // which runMacroCommand treats as "no override".
        ...(match.command.model
          ? {
              modelId: resolveModelAlias(match.command.model, speakerRoute.modelId ?? undefined),
            }
          : {}),
      },
    )
  }
  // No matching plugin command — whether bare `/<name>` or the namespaced
  // `/<plugin>:<command>` form. Fall through (return null) so skills and other
  // handlers get a chance. The final unresolved-slash gate reports an error if
  // neither layer claims it, so command-shaped input never silently reaches the model.
  return null
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
  const skill = skills.find((s) => s.name.toLowerCase() === skillCmd.name)
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
    )
  }
  // CC dynamic context injection: !`cmd` and ```!\n...\n``` blocks are pre-expanded
  // before argument substitution so command output can reference $ARGUMENTS etc.
  // SECURITY: only expand for filesystem skills (source='file'). Plugin-bundled skills
  // go through the enable trust gate already; still restrict to user's own file skills
  // where the trust model is clearer (the user wrote or explicitly checked in the file).
  const workingDir = await ctx.resolveSessionWorkingDir(userId, session)
  // Inject CC skill env vars so !`cmd` scripts can reference them.
  const skillEnv: Record<string, string> = {
    CLAUDE_SESSION_ID: sessionId,
    CLAUDE_EFFORT: (speaker ?? sessionRoute(session)).reasoningEffort ?? 'low',
    CLAUDE_PROJECT_DIR: workingDir,
    ...(skill.path ? { CLAUDE_SKILL_DIR: dirname(skill.path) } : {}),
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
  const instruction = applySkillArguments(expandedContent, skillCmd.arg, {
    argumentNames: skill.argumentNames,
    skillDir: skill.path ? dirname(skill.path) : undefined,
    sessionId,
    effort: (speaker ?? sessionRoute(session)).reasoningEffort ?? 'low',
    projectDir: workingDir,
  })
  // Curator usage telemetry — a slash-command invocation counts as a use.
  recordSkillUse(
    skill.name,
    skill.scope,
    skill.scope === 'project' ? (session.projectId ?? '') : '',
  )

  // CC `context: fork` — run the skill in an isolated delegate sub-agent.
  if (skill.contextFork && spawnForkSkill) {
    const childId = await spawnForkSkill(userId, sessionId, instruction, {
      ...(speaker ? { invokedBy: speaker.agentId } : {}),
      subagentType: skill.forkAgent,
      title: `/${skill.name}${skillCmd.arg ? ' ' + skillCmd.arg : ''}`,
      preferredModel: skill.preferredModel,
      preferredEffort: skill.preferredEffort,
      // CC skill frontmatter `hooks` — activated for the forked sub-agent run.
      ...(skill.hooks ? { hooks: skill.hooks } : {}),
    })
    return insertDirectReply(
      userId,
      sessionId,
      prompt,
      `Skill \`/${skill.name}\` started in a sub-agent (session \`${childId.slice(0, 8)}…\`). Results will appear in the runtime panel.`,
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
      ...(skill.hooks ? { ccScopedHooks: [{ raw: skill.hooks, source: 'skill' as const }] } : {}),
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

/** Final slash-routing gate. Control, plugin, and skill handlers all had their
 * chance before this runs; a remaining command-shaped token is therefore an
 * error, not model input. This prevents typos and client-only commands on an
 * unsupported surface from silently becoming agent prompts. */
export async function handleUnresolvedSlashCommand(
  ctx: Pick<CommandHandlerContext, 'insertDirectReply' | 'now'>,
  userId: string,
  sessionId: string,
  _session: SessionRecord,
  prompt: string,
): Promise<MessageMutationResponse | null> {
  const invocation = parseSlashInvocation(prompt)
  if (!invocation) return null

  const spec = resolveCommandSpec(invocation.name)
  const reply =
    spec?.scope === 'client'
      ? `Command \`/${spec.name}\` must be handled by a compatible client and is not available on this surface.`
      : (() => {
          const suggestions = suggestCommands(invocation.name)
          const hint = suggestions.length
            ? ` Did you mean ${suggestions.map((candidate) => `\`/${candidate.name}\``).join(', ')}?`
            : ' Run `/help` to see available commands.'
          return `Unknown slash command \`/${invocation.name}\`.${hint}`
        })()
  return ctx.insertDirectReply(userId, sessionId, prompt, reply, ctx.now())
}
