import { dirname, join } from 'node:path'
import { createResourceContextProvider } from '@localixai/mini-app-sdk/backend'
import { AgentSessionsService } from '../features/external-agents/backend/service'
import { createExternalAgentResourceProvider } from '../features/external-agents/backend/resource-provider'
import { createHistoryWsFrames } from '../features/external-agents/backend/history-frames'
import { createExternalAgentSessionsTool } from '../features/external-agents/backend/agent-tool'
import {
  installedExternalAgents,
  detectInstalledExternalAgents,
} from '../features/external-agents/installed'
import { agentTerminalReader } from '../features/terminal/agent-scope'
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
  const terminals = agentTerminalReader(() => serviceRefs.terminalService)
  const user = env.LOCALIX_DEFAULT_USER_ID
  service.setTerminalRead({
    screen: (input) => terminals.screen({ ...input, userId: user }),
    list: (input) => terminals.list({ ...input, userId: user }),
    finalScreen: (input) => terminals.finalScreen({ ...input, userId: user }),
    watch: (input, onEvent) => terminals.watch({ userId: user, ...input }, onEvent),
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
      observe: service.handleToolCall.bind(service),
    },
  }
}
