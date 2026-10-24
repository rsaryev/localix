import { sessionRoute } from '../../../contracts/session-route'
import { commandTarget } from './command-participant'
import { toolOverrideOptions } from './tool-override-options'
import { parsePluginCommandArgs, renderPluginPrompt } from './plugin-commands'
import type { MessageBinding } from '@localixai/agent'
import { resolveMessageBindings } from './message-bindings'
import type { SessionRecord } from '../repository'
import { resolveModelAlias } from '../../agent-core/model-alias'
import { announceSkillInvoked } from '../../agent-core/skill-invocations'
import { nextActivatedTools } from '../runtime/run/tool-deferral'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext } from './command-handlers-context'
import { findPluginSkill } from './command-handlers-skill'
import { SkillCommandFailedError } from './skill-commands'

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
  // A skill and a command of the same name: the skill runs (Claude Code, "Resolve skills that
  // share a name"). The skill handler, later in the dispatch, takes it.
  const sameNameSkill = match
    ? findPluginSkill(
        await ctx.gatherEnabledPluginSkills(userId, session),
        `${match.plugin}:${match.command.name}`.toLowerCase(),
      )
    : undefined
  if (sameNameSkill && sameNameSkill.userInvocable !== false) return null
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
      return insertDirectReply(userId, sessionId, prompt, parsed.usage, ts, 'warning')
    }
    const projectDir = await ctx.resolveSessionWorkingDir(userId, session)
    let instruction: string
    try {
      instruction = await renderPluginPrompt(match.command.prompt, parsed.values, argString, {
        sessionId,
        effort: speakerRoute.reasoningEffort ?? undefined,
        pluginDir: match.pluginDir,
        pluginName: match.plugin,
        ...(match.dataDir ? { dataDir: match.dataDir } : {}),
        projectDir,
        // CC dynamic content (`!\`cmd\``, `@path`) runs in the session working dir.
        cwd: projectDir,
        arguments: match.command.arguments,
      })
    } catch (error) {
      // CC: a failed injected command aborts the invocation; the model never sees the command.
      if (!(error instanceof SkillCommandFailedError)) throw error
      const reply = `\`${firstToken}\`: ${error.message.slice(0, 4000)}`
      return insertDirectReply(userId, sessionId, prompt, reply, ts, 'error')
    }
    const resolvedBindings = await resolveMessageBindings(deps, userId, session, bindings)
    if (match.command.activateTools?.length) {
      const tools = match.command.activateTools
      const stored = await repo.changeActivatedTools(userId, sessionId, (current) =>
        nextActivatedTools(current, tools),
      )
      if (stored) session.activatedTools = stored.next
    }
    // A command is a skill in Claude Code: a monitor `on-skill-invoke:<plugin>:<command>` starts.
    announceSkillInvoked({
      userId,
      sessionId: session.rootSessionId ?? sessionId,
      skillName: match.command.name,
      pluginName: match.plugin,
      ...(projectDir ? { cwd: projectDir } : {}),
    })
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
