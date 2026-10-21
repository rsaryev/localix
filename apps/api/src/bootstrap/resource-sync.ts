import type { AppDeps } from '../app'
import { observeMutations } from '../features/realtime/observe-mutations'
import type { RealtimeResource } from '../features/realtime/resources'
import { capabilitiesChanged, trackCapabilityChange } from '../features/capabilities/revision'
import type { createChatService } from '../features/chat/service'
import type { AgentsService } from '../features/agents/service'
import type { SkillsCuratorService } from '../features/skills-curator/service'

/** The composition root owns which read models a committed service mutation invalidates. */
export function installResourceSync(
  deps: Pick<
    AppDeps,
    | 'projectsService'
    | 'userService'
    | 'providerConnectionsService'
    | 'secretsService'
    | 'systemService'
  > & {
    chatService: ReturnType<typeof createChatService>
    agentsService: AgentsService
    skillsCuratorService: SkillsCuratorService
    defaultUserId: string
  },
): void {
  const publish = (userId: string, resources: readonly RealtimeResource[]) => {
    if (resources.includes('capabilities')) capabilitiesChanged()
    deps.chatService.streamRegistry.publish(userId, '', {
      type: 'resources.changed',
      resources: [...new Set(resources)],
    })
  }
  // Every observed call is one tracked mutation: one that already moved the revision (a rule
  // write) is announced without a second bump.
  const observe: typeof observeMutations = (service, mutations, sink) => {
    observeMutations(service, mutations, sink)
    const target = service as Record<string, unknown>
    for (const name of Object.keys(mutations)) {
      const call = target[name] as (...args: unknown[]) => unknown
      target[name] = (...args: unknown[]) => trackCapabilityChange(() => call.apply(service, args))
    }
  }
  observe(
    deps.projectsService,
    {
      createProject: ['projects'],
      resolveProjectByPath: ['projects'],
      updateProject: ['projects', 'capabilities', 'sessions'],
      deleteProject: ['projects', 'capabilities'],
    },
    publish,
  )
  observe(
    deps.userService,
    {
      updateProfile: (_userId, patch) =>
        patch.agentSettings !== undefined || patch.agentSettingsPatch !== undefined
          ? ['profile', 'capabilities', 'sessions']
          : ['profile'],
    },
    publish,
  )
  const writeViewState = deps.userService.writeViewState.bind(deps.userService)
  deps.userService.writeViewState = async (...args) => {
    const result = await writeViewState(...args)
    if (result.accepted) publish(args[0], ['view-state'])
    return result
  }
  observe(
    deps.providerConnectionsService,
    {
      createConnection: ['providers', 'capabilities'],
      updateConnection: ['providers', 'capabilities', 'sessions'],
      deleteConnection: ['providers', 'capabilities', 'sessions'],
      addKey: ['providers', 'vault'],
      updateKey: ['providers', 'vault'],
      removeKey: ['providers', 'vault'],
      completeOAuth: ['providers', 'capabilities', 'vault'],
    },
    publish,
  )
  observe(
    deps.agentsService,
    {
      createAgent: ['capabilities'],
      updateAgent: ['capabilities', 'sessions'],
      deleteAgent: ['capabilities'],
      resetAgent: ['capabilities', 'sessions'],
      duplicateAgent: ['capabilities'],
      setAgentEnabled: ['capabilities'],
    },
    publish,
  )
  observe(deps.agentsService.registrationPolicy, { publish: ['capabilities'] }, publish)
  // Skills are files: their writers had no hook, so neither clients nor the index heard of them.
  observe(
    deps.chatService,
    { createSkill: ['capabilities'], updateSkill: ['capabilities'], deleteSkill: ['capabilities'] },
    publish,
  )
  observe(
    deps.skillsCuratorService,
    {
      setPinned: ['capabilities'],
      archive: ['capabilities'],
      restore: ['capabilities'],
      runCurator: ['capabilities'],
    },
    publish,
  )
  observe(
    deps.secretsService,
    {
      create: ['vault'],
      rotate: ['vault'],
      updateMetadata: ['vault'],
      remove: ['vault'],
    },
    publish,
  )
  const setToggle = deps.systemService.setToggle.bind(deps.systemService)
  deps.systemService.setToggle = async (...args) => {
    const result = await setToggle(...args)
    publish(deps.defaultUserId, ['system'])
    return result
  }
}
