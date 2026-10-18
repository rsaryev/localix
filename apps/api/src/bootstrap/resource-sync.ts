import type { AppDeps } from '../app'
import { observeMutations } from '../features/realtime/observe-mutations'
import type { RealtimeResource } from '../features/realtime/resources'
import { bumpCapabilityRevision } from '../features/capabilities/revision'
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
    if (resources.includes('capabilities')) bumpCapabilityRevision()
    deps.chatService.streamRegistry.publish(userId, '', {
      type: 'resources.changed',
      resources: [...new Set(resources)],
    })
  }
  observeMutations(
    deps.projectsService,
    {
      createProject: ['projects'],
      resolveProjectByPath: ['projects'],
      updateProject: ['projects', 'capabilities', 'sessions'],
      deleteProject: ['projects', 'capabilities'],
    },
    publish,
  )
  observeMutations(
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
  observeMutations(
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
  observeMutations(
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
  observeMutations(deps.agentsService.registrationPolicy, { publish: ['capabilities'] }, publish)
  // Skills are files: their writers had no hook, so neither clients nor the index heard of them.
  observeMutations(
    deps.chatService,
    { createSkill: ['capabilities'], updateSkill: ['capabilities'], deleteSkill: ['capabilities'] },
    publish,
  )
  observeMutations(
    deps.skillsCuratorService,
    {
      setPinned: ['capabilities'],
      archive: ['capabilities'],
      restore: ['capabilities'],
      runCurator: ['capabilities'],
    },
    publish,
  )
  observeMutations(
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
