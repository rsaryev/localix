import type {
  AgentRequest,
  McpCaller,
  ModelRequest,
  ModelRunner,
  PortFailure,
} from '@rsaryev/llx-plugin'
import { errorMessage } from '../../../../lib/errors'

/**
 * The ports whose engines belong to a session or come up late in bootstrap: MCP clients and the
 * models. Each reads its engine through a getter at call time, so `createHostPorts` is built before
 * the engine exists and a session binds its own.
 */

/** Localix's MCP call by full name (`mcp__server__tool`); it resolves, never throws. */
/** One MCP tool call's answer; a server that is not there says `notConnected`. */
export type CcMcpToolResult = { text: string; isError?: boolean } | { notConnected: true }

export type McpCallByName = (
  name: string,
  input: unknown,
  signal?: AbortSignal,
) => Promise<CcMcpToolResult>

const unavailable = (what: string): PortFailure => ({
  failure: 'unavailable',
  message: `${what} is not available here`,
})

const withTimeout = (signal: AbortSignal, timeoutMs: number | undefined): AbortSignal =>
  timeoutMs ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : signal

/**
 * `ensureConnected` answers from whether a caller is bound: Localix connects a server when its
 * tools are first resolved, and has no wait of its own yet.
 */
export function lateMcpCaller(caller: () => McpCallByName | undefined): McpCaller {
  return {
    ensureConnected: async () => (caller() ? 'connected' : 'unavailable'),
    async callTool(call) {
      const bound = caller()
      const server = `MCP server ${call.server}`
      if (!bound) return unavailable(server)
      const signal = withTimeout(call.signal, call.timeoutMs)
      const result = await bound(`mcp__${call.server}__${call.tool}`, call.input, signal)
      if ('notConnected' in result) return unavailable(server)
      return { isError: result.isError === true, text: result.text }
    },
  }
}

/** Localix's model calls, answering with the model's text. */
export interface ModelBackend {
  complete(request: ModelRequest): Promise<string>
  runAgent(request: AgentRequest): Promise<string>
}

async function answer<R extends ModelRequest>(
  request: R,
  run: ((request: R) => Promise<string>) | undefined,
) {
  if (!run) return unavailable('A model')
  const signal = withTimeout(request.signal, request.timeoutMs)
  try {
    return { text: await run({ ...request, signal }) }
  } catch (error) {
    const timedOut = signal.aborted && !request.signal.aborted
    return { failure: timedOut ? 'timeout' : 'model', message: errorMessage(error) }
  }
}

export function lateModelRunner(models: () => ModelBackend | undefined): ModelRunner {
  return {
    evaluate: (request) => {
      const backend = models()
      return answer(request, backend && ((bound) => backend.complete(bound)))
    },
    runAgent: (request) => {
      const backend = models()
      return answer(request, backend && ((bound) => backend.runAgent(bound)))
    },
  }
}
