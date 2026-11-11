import { useChatStore } from '@/entities/chat/model/store'
import { defaultModelOf, defaultProject } from '@/entities/chat/model/defaultProjectModel'
import { selectSessionModelId } from '@/entities/chat/ui/prompt-input/connectionScope'
import { modelChosen, type SetupStepId } from './setupSteps'

/**
 * Which steps are already done, read from the app instead of asked: a model a chat can run on,
 * and a folder open. The other steps are choices with good defaults, never "not done".
 */
export function useSetupDone(): Partial<Record<SetupStepId, boolean>> {
  const connections = useChatStore((s) => s.connections)
  const projects = useChatStore((s) => s.projects)
  const activeProjectId = useChatStore((s) => s.activeProjectId)
  const chatModelId = useChatStore((s) => selectSessionModelId(s, s.activeSessionId))
  return {
    model: modelChosen({
      runnable: connections.filter((c) => c.hasApiKey).map((c) => c.id),
      defaultModel: defaultModelOf(defaultProject(projects)),
      chatModelId: chatModelId || null,
    }),
    folder: projects.some((p) => p.id === activeProjectId && !p.isDefault),
  }
}
