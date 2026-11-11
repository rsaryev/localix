import { randomUUID } from 'node:crypto'
import type { AgentTool } from '@localixai/agent/agents'
import { TOOL } from '../../agent-core/tool-names'
import { claudeCodeToolResponse } from '../../ext/cc-tool-shapes'
import { claudeCodeToolName, localToolName, toolInputOf } from '../../plugins/kit'
import type {
  ModHostPortsInput as KitModHostPorts,
  ModSessionPorts as KitModSessionPorts,
} from '@rsaryev/llx-plugin/mods'
import type { ModVerdict } from '../tool-check'

/**
 * `$.tool`, `$.mcp`, `$.ui.ask` and `$.agent.spawn` as a Localix conversation answers them: with
 * the tools its running turn lends (`RunSurface`), under Claude Code's names and arguments. With no
 * turn running, a call says so. The lent tools are the turn's own after the permission gate: a run
 * with mods active puts the gate inside the tool-call chain (`run-scope.ts`, `gateInChain`), so a
 * call a mod makes meets the person's rules and mode exactly as the model's would, and a refusal is
 * what the call answers.
 */

export interface RunSurface {
  tools: readonly AgentTool[]
  /** The run's permission verdict on a call, before anyone is asked (`$.tool.check`). */
  verdict?: (toolName: string, input: unknown) => ModVerdict
}

export interface RunToolsDeps {
  /** The conversation's running turn, while it runs. */
  surface: () => RunSurface | undefined
  /** Where the call's paths resolve: the conversation's working directory. */
  cwd: string
  /** The definition of a subagent type a mod registered (`$.agent.register`). */
  agentType: (name: string) => Readonly<Record<string, unknown>> | undefined
}

interface AskAnswer {
  selectedOptions: string[]
  customInput?: string
}

type Fields = Record<string, unknown>

const string = (value: unknown) => (typeof value === 'string' ? value : undefined)
const text = (content: unknown) =>
  typeof content === 'string' ? content : JSON.stringify(content ?? '')

/** A server as a mod names it — its name, `plugin:<plugin>:<server>` — as its tools' prefix. */
const serverPrefix = (server: string) => {
  const scoped = /^plugin:([^:]+):(.+)$/.exec(server)
  return `mcp__${scoped ? `plugin_${scoped[1]}_${scoped[2]}` : server}__`
}

export function createRunTools(deps: RunToolsDeps) {
  const running = () => {
    const run = deps.surface()
    if (!run) throw new Error('No turn is running in this conversation')
    return run
  }
  const named = (name: string) =>
    running().tools.find(
      (candidate) =>
        claudeCodeToolName(candidate) === name ||
        candidate.name === name ||
        // `Glob` is `search`, `SendMessage` the agent tool: every name Claude Code calls it by.
        localToolName(name) === candidate.name ||
        candidate.aliases?.includes(name),
    )
  const find = (name: string) => {
    const tool = named(name)
    if (!tool) throw new Error(`No tool named ${name} in this turn`)
    return tool
  }
  const execute = (tool: AgentTool, input: Fields, signal?: AbortSignal, id?: unknown) =>
    tool.execute(typeof id === 'string' ? id : `mod-${randomUUID()}`, input, signal)

  const tools: KitModSessionPorts['tools'] = {
    async call(event, signal) {
      const tool = find(String(event.tool))
      const own = toolInputOf(tool.name, event as Fields)
      const result = await execute(tool, own, signal, event.tool_use_id)
      // As `next(e)` resolves on `tool.call`: the tool's own record, and the text it read.
      return {
        result: claudeCodeToolResponse(tool, result, own, deps.cwd),
        text: result.content,
        ...(result.isError ? { isError: true } : {}),
      }
    },
    /** The turn's verdict on a call it does not make. */
    async check(event) {
      const verdict = running().verdict
      if (!verdict) throw new Error('$.tool.check: this turn decides no permissions')
      const tool = find(String(event.tool))
      const args = event.input && typeof event.input === 'object' ? (event.input as Fields) : {}
      return verdict(tool.name, toolInputOf(tool.name, args))
    },
  }

  const mcp: NonNullable<KitModHostPorts['mcp']> = {
    async ensureConnected(server) {
      const prefix = serverPrefix(server)
      const lent = deps.surface()?.tools ?? []
      return lent.some((tool) => claudeCodeToolName(tool).startsWith(prefix))
        ? 'connected'
        : 'unavailable'
    },
    async callTool(call) {
      const result = await execute(find(`${serverPrefix(call.server)}${call.tool}`), {
        ...call.input,
      })
      return { isError: result.isError === true, text: text(result.content) }
    },
  }

  return {
    tools,
    mcp,
    /** The turn's question card, Claude Code's AskUserQuestion: the label chosen or what was typed. */
    async ask(request: { question: string; options: readonly string[] }): Promise<string> {
      const result = await find('AskUserQuestion').execute(`mod-ask-${randomUUID()}`, {
        questions: [
          {
            id: 'answer',
            question: request.question,
            options: request.options.map((label) => ({ label })),
          },
        ],
      })
      const answer = (result.details as { answers?: AskAnswer[] } | undefined)?.answers?.[0]
      if (!answer) throw new Error(result.content)
      return answer.customInput?.trim() || answer.selectedOptions.join(', ')
    },
    /**
     * A subagent as Localix runs one, a child session the turn's `Agent` tool starts: `{ agentId }`
     * or `{ deny }`. `name` is what the child is addressed by; a registered type's `initialPrompt`
     * frames the prompt where it says `{{intent}}`.
     */
    async spawn(request: Fields) {
      const prompt = string(request.prompt)
      if (!prompt) throw new Error('$.agent.spawn takes a prompt')
      const agent = deps.surface()?.tools.find((tool) => tool.name === TOOL.Agent)
      if (!agent) return { deny: 'Subagents start from a running turn of a conversation' }
      const type = string(request.subagentType)
      const first = string(type ? deps.agentType(type)?.initialPrompt : undefined)
      const description = string(request.description) ?? prompt.slice(0, 60)
      const result = await agent.execute(`mod-agent-${randomUUID()}`, {
        prompt: first?.includes('{{intent}}') ? first.replaceAll('{{intent}}', prompt) : prompt,
        description: (string(request.name) ?? description).slice(0, 120),
        ...(type ? { subagent_type: type } : {}),
        // The child's model, which `Agent` takes from its host, never from the model.
        ...(string(request.model) ? { model: string(request.model) } : {}),
      })
      const started = (result.details as { tasks?: { sessionId?: string }[] } | undefined)
        ?.tasks?.[0]
      if (result.isError || !started?.sessionId) return { deny: result.content }
      return { agentId: started.sessionId, model: string(request.model) ?? '' }
    },
  }
}

export type RunTools = ReturnType<typeof createRunTools>
