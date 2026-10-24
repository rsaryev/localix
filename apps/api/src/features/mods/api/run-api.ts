import { randomUUID } from 'node:crypto'
import type { AgentTool } from '@localixai/agent/agents'
import { claudeCodeToolResponse } from '../../ext/cc-tool-shapes'
import type { ModVerdict } from '../tool-check'
import { claudeCodeToolName, localToolName, toolInputOf } from '../tool-shapes'

/**
 * `$.tool`, `$.mcp` and `$.ui.ask`: the tools of the conversation's running turn, as Claude Code's mods call
 * them — under Claude Code's names and arguments, a result as `{ result, text }`. The turn lends them
 * (`RunSurface`) while it runs; with none running, a call says so. `$.tool.call` is an event too
 * (`tool.call`), so the other mods' hooks see it before the tool runs.
 */

export interface RunSurface {
  tools: readonly AgentTool[]
  /** The run's permission verdict on a call, before anyone is asked (`$.tool.check`). */
  verdict?: (toolName: string, input: unknown) => ModVerdict
}

interface AskSpec {
  options?: unknown[]
  multiSelect?: boolean
}

interface AskAnswer {
  selectedOptions: string[]
  customInput?: string
}

const text = (content: unknown) =>
  typeof content === 'string' ? content : JSON.stringify(content ?? '')

export function createRunApi(
  surface: () => RunSurface | undefined,
  /** Where the call's paths resolve: the conversation's working directory. */
  cwd: () => string | undefined = () => undefined,
) {
  const running = () => {
    const run = surface()
    if (!run) throw new Error('No turn is running in this conversation')
    return run
  }
  const find = (name: string) => {
    const tool = running().tools.find(
      (candidate) =>
        claudeCodeToolName(candidate) === name ||
        candidate.name === name ||
        // `Glob` is `search`, `SendMessage` the agent tool: every name Claude Code calls it by.
        localToolName(name) === candidate.name ||
        candidate.aliases?.includes(name),
    )
    if (!tool) throw new Error(`No tool named ${name} in this turn`)
    return tool
  }
  const execute = async (tool: AgentTool, input: Record<string, unknown>, id?: unknown) =>
    tool.execute(typeof id === 'string' ? id : `mod-${randomUUID()}`, input)

  return {
    tool: {
      list: () =>
        (surface()?.tools ?? []).map((tool) => ({
          name: claudeCodeToolName(tool),
          description: tool.description,
          mcp: claudeCodeToolName(tool).startsWith('mcp__'),
        })),
      async call(input: unknown) {
        const event = (input ?? {}) as Record<string, unknown>
        if (typeof event.tool !== 'string') throw new Error('tool.call names the tool to call')
        const tool = find(event.tool)
        const own = toolInputOf(tool.name, event)
        const result = await execute(tool, own, event.tool_use_id)
        // As `next(e)` resolves on `tool.call`: the tool's own record, and the text it read.
        return {
          result: claudeCodeToolResponse(tool, result, own, cwd()),
          text: result.content,
          ...(result.isError ? { isError: true } : {}),
        }
      },
      /** `$.tool.check`: the turn's verdict on a call it does not make. */
      check(input: unknown) {
        const event = (input ?? {}) as Record<string, unknown>
        if (typeof event.tool !== 'string') throw new Error('tool.check names the tool to check')
        const verdict = running().verdict
        if (!verdict) throw new Error('tool.check: this turn decides no permissions')
        const tool = find(event.tool)
        const args = event.input && typeof event.input === 'object' ? event.input : {}
        return verdict(tool.name, toolInputOf(tool.name, args as Record<string, unknown>))
      },
    },
    ui: {
      /**
       * `$.ui.ask`: the turn's question card — Claude Code's AskUserQuestion — answered with the
       * label chosen, the labels comma-joined, or what the person typed; rejects when skipped.
       */
      async ask(question: unknown, options?: unknown) {
        if (typeof question !== 'string') throw new Error('ui.ask takes a question')
        const spec: AskSpec = Array.isArray(options) ? { options } : ((options ?? {}) as AskSpec)
        const labels = (spec.options ?? []).filter((label) => typeof label === 'string')
        const result = await find('AskUserQuestion').execute(`mod-ask-${randomUUID()}`, {
          questions: [
            {
              id: 'answer',
              question,
              options: labels.map((label) => ({ label })),
              ...(spec.multiSelect ? { multi: true } : {}),
            },
          ],
        })
        const answer = (result.details as { answers?: AskAnswer[] } | undefined)?.answers?.[0]
        if (!answer) throw new Error(`ui.ask: ${result.content}`)
        return answer.customInput?.trim() || answer.selectedOptions.join(', ')
      },
    },
    mcp: {
      /** A server is its name, or a plugin's as `plugin:<plugin>:<server>` or `plugin_<p>_<s>`. */
      async call(server: unknown, name: unknown, args?: unknown) {
        if (typeof server !== 'string' || typeof name !== 'string')
          throw new Error('mcp.call takes a server and a tool')
        const scoped = /^plugin:([^:]+):(.+)$/.exec(server)
        const address = `mcp__${scoped ? `plugin_${scoped[1]}_${scoped[2]}` : server}__${name}`
        const result = await execute(find(address), (args ?? {}) as Record<string, unknown>)
        return {
          content: [{ type: 'text', text: text(result.content) }],
          isError: result.isError === true,
        }
      },
    },
  }
}
