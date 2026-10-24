import type { PluginCommand } from '../../plugins/contracts'
import { pluginDataDir } from '../../plugins/mcp'
import { resolveWebhookUrl } from '../../../lib/runtime-address'
import { userHome } from '../../../lib/env'
import { expandFileReferences } from './file-references'
import { expandSkillContent } from './skill-commands'
import { receivesArguments, splitSkillArgs } from './slash-commands'

/**
 * Parse positional args from a namespaced plugin command's argument string against
 * its declared `args`, in order. A `choice` arg consumes one whitespace token and is
 * validated against its options; a `text` arg consumes one token, except the LAST
 * declared arg captures the entire remaining string. Returns the value map, or a
 * `usage` string when a required arg is missing/invalid.
 */
export function parsePluginCommandArgs(
  command: PluginCommand,
  argString: string,
  /** The plugin name — used in usage messages so they show the full `/<plugin>:<cmd>` form. */
  pluginName?: string,
): { values: Record<string, string> } | { usage: string } {
  const values: Record<string, string> = {}
  let rest = argString.trim()
  const cmdPath = pluginName ? `${pluginName}:${command.name}` : command.name
  const usageLine = () => {
    const parts = command.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
    return `Usage: \`/${cmdPath}${parts.length ? ' ' + parts.join(' ') : ''}\``
  }
  const missingArg = (arg: PluginCommand['args'][number]) => ({
    usage: `${usageLine()}\nMissing required argument \`${arg.name}\`${arg.description ? ` — ${arg.description}` : ''}.`,
  })
  for (let i = 0; i < command.args.length; i++) {
    const arg = command.args[i]
    const isLast = i === command.args.length - 1
    // Conditional arg: only present once an earlier chip took the required value
    // (mirrors the composer's `when` gating). Skip without consuming a token so a
    // `${name}` placeholder renders empty when the arg isn't in play.
    if (arg.when && values[arg.when.arg] !== arg.when.equals) {
      values[arg.name] = ''
      continue
    }
    if (arg.type === 'text' && isLast) {
      const value = rest
      rest = ''
      if (!value && arg.required) {
        return missingArg(arg)
      }
      values[arg.name] = value
      continue
    }
    const beforeConsume = rest
    const match = rest.match(/^(\S+)\s*([\s\S]*)$/)
    const token = match?.[1] ?? ''
    rest = match?.[2] ?? ''
    if (arg.type === 'choice') {
      const options = arg.options ?? []
      const valid = options.some((o) => o.value === token)
      if (!valid) {
        // DYNAMIC choice (`optionsScript`): a combobox whose options aren't known here
        // (they load in the composer), so accept any non-empty token verbatim.
        if (arg.optionsScript && token) {
          values[arg.name] = token
          continue
        }
        if (!arg.required) {
          values[arg.name] = ''
          rest = beforeConsume
          continue
        }
        const optionList = options
          .map((o) => `\`${o.value}\`${o.description ? ` — ${o.description}` : ''}`)
          .join('\n- ')
        return {
          usage: `Argument \`${arg.name}\` must be one of:\n- ${optionList || '(none declared)'}`,
        }
      }
      values[arg.name] = token
      continue
    }
    if (!token && arg.required) {
      return missingArg(arg)
    }
    values[arg.name] = token
  }
  return { values }
}

/**
 * Render a plugin command prompt. Substitutes, in order:
 * - `${argName}` — declared arg values from the parsed `values` map.
 * - `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}` — session env vars (CC compat).
 * - `${CLAUDE_WEBHOOK_URL}` — this instance's inbound-webhook URL (host runtime
 *   context), so a command can hand a delegated process the real address instead
 *   of reconstructing it. Also exported to `!\`cmd\`` shell embeds as `$CLAUDE_WEBHOOK_URL`.
 * - `$ARGUMENTS` (full raw arg string), `$ARGUMENTS[N]` / `$N` (Nth token; left as written when
 *   there is none).
 * - If no placeholder receives the arguments, appends `ARGUMENTS: <rawArgs>`.
 * - `\$` — backslash-escape for literal `$`.
 * - CC dynamic content (only when a `cwd` is provided): `` !`cmd` `` / ` ```! ` bash-embeds
 *   (executed in `cwd`, reusing the skill-command runner — 10s timeout, output-capped) and
 *   `@path` file references (inlined, confined to `cwd`/plugin dir, size-capped).
 * A `${name}` that is no declared arg stays as written. Async because the dynamic content runs shells + FS.
 */
export const renderPluginPrompt = async (
  template: string,
  values: Record<string, string>,
  rawArgs = '',
  ctx?: {
    sessionId?: string
    effort?: string
    pluginDir?: string
    pluginName?: string
    /** The plugin's `CLAUDE_PLUGIN_DATA`, keyed by its identifier. */
    dataDir?: string
    projectDir?: string
    /** Working dir for CC dynamic content (`!\`cmd\`` + `@path`). Omit to skip that stage. */
    cwd?: string
    /** CC `arguments`: names of the positional arguments, filling `$name`. */
    arguments?: readonly string[]
  },
): Promise<string> => {
  // The same home `session-workspace` built the command's catalog with.
  const dataDir = ctx?.dataDir ?? (ctx?.pluginName ? pluginDataDir(ctx.pluginName, userHome()) : '')
  // Remember whether the authored template consumes user arguments. This must be
  // checked before `${argName}` substitution removes the evidence. Environment
  // placeholders do not count: a command that only references its session/project
  // still needs to receive the user's free-form input.
  const hasDeclaredArgumentPlaceholder = Object.keys(values).some((name) =>
    template.includes(`\${${name}}`),
  )
  const named = namedArguments(values, ctx?.arguments)
  const trimmed = rawArgs.trim()
  const tokens = splitSkillArgs(trimmed)
  const consumesArguments =
    hasDeclaredArgumentPlaceholder || receivesArguments(template, tokens, named)
  let out = template
  // 1) CC dynamic content — run FIRST, over the TEMPLATE, before any user-controlled
  //    arg values are substituted in. Otherwise a `${argName}` value containing an
  //    `` !`cmd` `` / `` ```! `` embed (or an `@path` file reference) would be executed
  //    or inlined server-side (render-time shell injection). Template-authored embeds
  //    read their inputs from the process env (`$CLAUDE_WEBHOOK_URL` etc.) below, never
  //    from args, so running them first is safe and closes the injection vector. The arguments
  //    still reach a command's `$ARGUMENTS` / `$N` / `$name`, each as one quoted shell word, as
  //    Claude Code inserts them before its commands run.
  //    Only when a working dir is available (dispatch path).
  if (ctx?.cwd) {
    const env: Record<string, string> = {}
    // env-vars.md: CLAUDE_CODE_SESSION_ID is the session id in every Bash subprocess.
    if (ctx.sessionId) {
      env.CLAUDE_SESSION_ID = ctx.sessionId
      env.CLAUDE_CODE_SESSION_ID = ctx.sessionId
    }
    if (ctx.effort) env.CLAUDE_EFFORT = ctx.effort
    env.CLAUDE_WEBHOOK_URL = resolveWebhookUrl()
    if (ctx.pluginDir) env.CLAUDE_PLUGIN_ROOT = ctx.pluginDir
    if (dataDir) env.CLAUDE_PLUGIN_DATA = dataDir
    if (ctx.projectDir) env.CLAUDE_PROJECT_DIR = ctx.projectDir
    out = await expandSkillContent(out, ctx.cwd, env, {
      raw: trimmed,
      ...(ctx.arguments ? { names: ctx.arguments } : {}),
    })
    out = await expandFileReferences(out, [ctx.cwd, ...(ctx.pluginDir ? [ctx.pluginDir] : [])])
  }
  // 2) Declared ${argName} placeholders + CC env vars (path vars + session env).
  out = out.replace(/\$\{([a-zA-Z0-9_-]+)\}/g, (match, name: string) => {
    if (name === 'CLAUDE_SESSION_ID') return ctx?.sessionId ?? ''
    if (name === 'CLAUDE_EFFORT') return ctx?.effort ?? ''
    if (name === 'CLAUDE_WEBHOOK_URL') return resolveWebhookUrl()
    if (name === 'CLAUDE_PLUGIN_ROOT') return ctx?.pluginDir ?? ''
    if (name === 'CLAUDE_PLUGIN_DATA') return dataDir
    if (name === 'CLAUDE_PROJECT_DIR') return ctx?.projectDir ?? ''
    // A name that is no declared arg is text the author wrote (a shell variable, a template for
    // the model to fill in): it stays as written, as Claude Code leaves it.
    return values[name] ?? match
  })
  // 3) Claude Code argument tokens from the raw arg string: `$name` (a declared arg's value, else
  //    its position in `arguments`), then `$ARGUMENTS`, `$ARGUMENTS[N]` and `$N`.
  for (const name of named) {
    const position = ctx?.arguments?.indexOf(name) ?? -1
    const value = values[name] ?? (position >= 0 ? (tokens[position] ?? '') : '')
    out = out.replace(namedPattern(name), (full: string, esc: string) =>
      esc ? full.slice(1) : value,
    )
  }
  out = out.replace(
    /(\\?)\$(?:ARGUMENTS(?:\[(\d+)\])?|(\d+))/g,
    (full: string, esc: string, bracketIdx?: string, bareIdx?: string) => {
      if (esc) return full.slice(1) // \$… → literal $…
      if (bareIdx !== undefined) return tokens[Number(bareIdx)] ?? full
      if (bracketIdx !== undefined) return tokens[Number(bracketIdx)] ?? full
      return trimmed // bare $ARGUMENTS
    },
  )
  if (trimmed && !consumesArguments) out = `${out}\n\nARGUMENTS: ${trimmed}`
  return out
}

/** Names `$name` may use: declared args and CC `arguments`, longest first so `$a` never eats `$ab`. */
function namedArguments(
  values: Record<string, string>,
  positional: readonly string[] | undefined,
): string[] {
  return [...new Set([...Object.keys(values), ...(positional ?? [])])].sort(
    (a, b) => b.length - a.length,
  )
}

const namedPattern = (name: string) =>
  new RegExp(`(\\\\?)\\$${name.replace(/[-]/g, '\\-')}(?![A-Za-z0-9_-])`, 'g')
