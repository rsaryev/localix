import { dirname, join } from 'node:path'
import { createResourceContextProvider } from '@localixai/plugin-sdk/backend'
import { AgentSessionsService } from '../features/external-agents/backend/service'
import { createExternalAgentResourceProvider } from '../features/external-agents/backend/resource-provider'
import { createHistoryWsFrames } from '../features/external-agents/backend/history-frames'
import { createExternalAgentSessionsTool } from '../features/external-agents/backend/agent-tool'
import {
  installedExternalAgents,
  detectInstalledExternalAgents,
} from '../features/external-agents/installed'
import { agentTerminalOf } from '../features/terminal/agent-scope'
import { watchPathNative } from '../features/fs-watch/path-watch'
import type { InfraPhase } from './infra'
import type { RegistriesPhase } from './registries'

export function createExternalAgentsPhase({
  env,
  logger,
  serviceRefs,
  resourceRefsRegistry,
  contextProviderRegistry,
  wsFrameRegistry,
  subsystemRegistry,
}: Pick<InfraPhase, 'env' | 'logger' | 'serviceRefs'> &
  Pick<
    RegistriesPhase,
    'resourceRefsRegistry' | 'contextProviderRegistry' | 'wsFrameRegistry' | 'subsystemRegistry'
  >) {
  const service = new AgentSessionsService(
    join(dirname(env.LOCALIX_DB_FILE), 'external-agents'),
    (message) => logger.warn({ event: 'external_agents.warning', message }),
    undefined,
    () => detectInstalledExternalAgents().map((agent) => agent.id),
  )
  const ready = service.start()
  void ready.catch((error: unknown) =>
    logger.warn({ event: 'external_agents.start_failed', error: String(error) }),
  )
  service.setPathWatch(watchPathNative)
  service.setTerminalRead({
    screen: async ({ sessionId, terminalId }) =>
      (await agentTerminalOf(
        serviceRefs.terminalService,
        env.LOCALIX_DEFAULT_USER_ID,
        sessionId,
        terminalId,
      )?.screen()) ?? null,
    list: ({ sessionId }) =>
      (serviceRefs.terminalService?.list(env.LOCALIX_DEFAULT_USER_ID) ?? []).flatMap((terminal) =>
        terminal.chatSessionId === sessionId
          ? [{ terminalId: terminal.id, command: terminal.command }]
          : [],
      ),
    finalScreen: async ({ sessionId, terminalId }) => {
      const terminal = serviceRefs.terminalService
      const archived = terminal?.archivedTerminal(env.LOCALIX_DEFAULT_USER_ID, terminalId)
      if (!sessionId || archived?.chatSessionId !== sessionId) return null
      return (await terminal?.finalScreen(env.LOCALIX_DEFAULT_USER_ID, terminalId)) ?? null
    },
  })
  const resources = createExternalAgentResourceProvider(service)
  resourceRefsRegistry.register(resources)
  contextProviderRegistry.register(
    createResourceContextProvider({
      id: 'external-agents:context',
      namespace: 'external-agents',
      expander: resources,
    }),
  )
  const history = createHistoryWsFrames(() => service.history)
  for (const frame of history.wsFrames) wsFrameRegistry.register(frame)
  subsystemRegistry.register({
    id: 'core:external-agents',
    onShutdown: () => {
      history.onShutdown()
      service.shutdown()
    },
  })
  return {
    service,
    port: {
      installed: installedExternalAgents,
      toolFor: (sessionId: string) => createExternalAgentSessionsTool(service, ready, sessionId),
      observe: (event: Parameters<AgentSessionsService['handleToolCall']>[0]) =>
        service.handleToolCall(event),
    },
  }
}
