/**
 * `external-agents` backend — THIN wiring only. Behaviour lives in the layers below.
 */

import { createResourceContextProvider } from '@localixai/plugin-sdk/backend'
import type { PluginContext, PluginRegistration } from '@localixai/plugin-sdk/backend'
import { getAgentSessionsService, disposeAgentSessionsService, whenStarted } from './singleton'
import { createAgentSessionsRoutes } from './routes'
import { createExternalAgentResourceProvider } from './resource-provider'
import { createHistoryWsFrames } from './history-frames'
import { buildAgentSessionsSchema, type AgentSessionsInput } from './tools/agent-sessions-schema'
import { runAgentSessions } from './tools/agent-sessions-tool'

export function register(ctx: PluginContext): PluginRegistration {
  const service = getAgentSessionsService(ctx.stateDir, ctx.log)
  // Hand the reader to the service on every load that has one. Without it live state is only ever
  // as fresh as the last screen the MODEL looked at; with it, `explain` can take a reading.
  service.setTerminalRead(ctx.terminalRead)
  // Same rule for the host's native watcher: Bun's own recursive fs.watch drops bursts on macOS.
  service.setPathWatch(ctx.watchPath)
  // ONE provider instance backs both seams: the resource tree the composer browses and the Context
  // Fabric resolver that expands a chosen ref at send time. Two instances would be two answers to
  // "what does this URI contain", and only one of them would be the one the user picked.
  const resourceProvider = createExternalAgentResourceProvider(service)
  const historyStream = createHistoryWsFrames(() => service.history)

  const tools = [
    ctx.defineTool({
      name: 'external_agent_sessions',
      description:
        "Browse coding-agent sessions from OTHER agents (Claude Code, Codex, opencode, Gemini CLI). Lists both LIVE delegations running in a terminal and HISTORICAL sessions read from those agents' own on-disk history, in one roster; explains a live agent's state, waits for any or all of them to settle instead of re-reading a screen, and pulls their transcripts as bounded, labelled context. Sessions are addressed by the `<provider>:<nativeSessionId>` key that `roster` returns — that key is what `explain`, `transcript`, `context` and `wait` take. To ATTACH a session to a conversation, reference it (`@resource` → External Agents) rather than calling this tool: a reference is durable on the message that carries it. Ask `stats` for a bounded summary of where external work happened — by agent, project and model, with the tokens each consumed — instead of paging the roster. Read-only with respect to other agents' files.",
      inputSchema: buildAgentSessionsSchema(ctx.z),
      activeVerb: 'Inspecting agent sessions',
      // Reads recorded external-agent history and nothing else.
      mutates: false,
      async execute(
        _toolCallId: string,
        input: AgentSessionsInput,
        signal: AbortSignal | undefined,
        _onUpdate,
        // The chat asking. Reading a live terminal needs it: the host verifies the pane belongs
        // to this session before rendering it.
        context?: { session?: { id?: string } },
      ) {
        await whenStarted()
        return runAgentSessions(service, input, signal, context?.session?.id ?? null)
      },
    }),
  ]

  return {
    backend: [
      {
        id: 'external-agents:sessions',
        routeMount: { path: '/rpc/agent-sessions', app: createAgentSessionsRoutes(service) },
        resourceProvider,
        contextProviders: [
          // Explicit only: a referenced localix://resource/external-agent session expands to the
          // provider's own bounded digest. The `provider` id is NOT spelled here — the factory
          // derives it from the expander, which is the authority on the URIs it owns.
          createResourceContextProvider({
            id: 'external-agents:context',
            namespace: 'external-agents',
            expander: resourceProvider,
          }),
        ],
        wsFrames: historyStream.wsFrames,
        onShutdown: () => {
          historyStream.onShutdown()
          disposeAgentSessionsService()
        },
      },
    ],
    tools,
    hooks: {
      /**
       * The live half of the plugin. Every `bash` terminal action's result carries the rendered
       * screen the host already produced for the model, so state detection is pure observation —
       * see backend/live/observe.ts.
       */
      onPostToolCall(event: {
        toolName: string
        input: unknown
        result: { content: string; details?: unknown }
        sessionId: string
      }) {
        service.handleToolCall(event)
      },
    },
  }
}
