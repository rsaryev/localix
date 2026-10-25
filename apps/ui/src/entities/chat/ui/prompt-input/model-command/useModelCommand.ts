import { useCallback, useMemo, useRef } from 'react'
import { sortProvidersByPopularity } from '@localixai/agent/catalog'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { useUserSettings } from '@/shared/lib/user-settings/useUserSettings'
import { backendClient } from '@/shared/api/client'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import { toast } from '@/shared/lib/notify'
import { findSessionInState } from '../../../model/findSession'
import { useChatStore } from '../../../model/store'
import type { AgentSummary, JoinRoutesView } from '@/shared/api/contracts'
import { participantRows, type ParticipantRecord } from '../model-select/participantRows'
import { recordRecentModel } from '../model-select/recentModels'
import { rememberAgentModelSettings } from '../model-select/rememberModelReasoning'
import { agentSettingsIo } from '../model-select/useAgentModelTurns'
import { notifyPartyRouteFailure } from '../model-select/partyRouteFailure'
import type { SkipArgFor } from '../SlashArgSpec'
import type { SlashCommand } from '../SlashCommandMenu'
import { effortStepOptions, resolveEffortCommand, skipEffortStep } from './modelCommandEffort'
import { resolveModelCommand, type ModelCommandPlan } from './modelCommandPlan'
import { modelStepOptions, skipModelStep } from './modelCommandSteps'
import type { ModelCommandContext } from './modelCommandTarget'

export const isModelCommand = (command: SlashCommand) => command.id === 'model'
/** `/effort`: `/model` entered at its reasoning step. */
export const isEffortCommand = (command: SlashCommand) => command.id === 'effort'

/**
 * `/model` as the picker's steps, inside the composer. Reads the same data the picker reads and,
 * on Enter, makes the same store writes the picker makes — so a selection made here and one made
 * in the picker cannot end in different states. A text that is not a complete selection is left
 * to the server (`/model <name>`).
 */
export function useModelCommand(
  sessionId: string | null,
  projectId: string | null,
  /** The conversation's connection — the picker's `sessionConnectionId`. */
  sessionConnectionId: string | null,
) {
  const { models, oauthProviderIds } = useModelsCatalog()
  const catalog = useRef({ models, oauthProviderIds })
  catalog.current = { models, oauthProviderIds }
  const records = useRef(new Map<string, ParticipantRecord>())
  /** The registry as the picker lists it: the agents not invited yet are rows too. */
  const directory = useRef<readonly AgentSummary[]>([])
  /** What each agent not invited yet would join on, as the picker shows it. */
  const joinRoutes = useRef<JoinRoutesView | null>(null)

  /** The picker's inputs as they are right now — a loader runs after the render it came from. */
  const context = useCallback((): ModelCommandContext => {
    const state = useChatStore.getState()
    const session = findSessionInState(state, sessionId)
    const agentSettings = useUserSettings.getState().settings.agentSettings
    return {
      participants: participantRows(
        session?.agents,
        (id) => records.current.get(id),
        session
          ? {
              agents: directory.current,
              choices: session.modelChoices,
              joinRoutes: joinRoutes.current,
            }
          : undefined,
      ),
      connections: sortProvidersByPopularity(state.connections, (row) => row.providerId),
      models: catalog.current.models,
      sessionConnectionId,
      agentModelSettings: agentSettings?.agentModelSettings,
      maxTurns: agentSettings?.maxTurns,
    }
  }, [sessionConnectionId, sessionId])

  const loadOptions = useCallback(
    async (
      argName: string,
      query: string,
      committed: Readonly<Record<string, string>>,
      commandId = 'model',
    ) => {
      // Registry names and turn ceilings, as the picker's Agents column shows them.
      if (argName === 'agent' || argName === 'turns') {
        const [snapshot, join] = await Promise.all([
          backendClient.fetchCapabilitySnapshot({ projectId: projectId ?? '' }).catch(() => null),
          sessionId ? backendClient.getJoinRoutes(sessionId).catch(() => null) : null,
        ])
        joinRoutes.current = join
        for (const agent of snapshot?.agents ?? [])
          records.current.set(agent.record.id, agent.record)
        if (snapshot) directory.current = snapshot.agents
      }
      return commandId === 'effort'
        ? effortStepOptions(context(), argName, query, committed)
        : modelStepOptions(context(), argName, query, committed)
    },
    [context, projectId, sessionId],
  )

  const skipArg = useCallback<SkipArgFor>(
    (command, name, committed) =>
      isEffortCommand(command)
        ? skipEffortStep(context(), name, committed)
        : isModelCommand(command) && skipModelStep(context(), name, committed),
    [context],
  )

  const apply = useCallback(
    async (plan: ModelCommandPlan) => {
      if (!sessionId) return
      const store = useChatStore.getState()
      if (plan.kind === 'party') {
        await store.applyPartyRoute(
          sessionId,
          {
            providerConnectionId: plan.connectionId,
            modelId: plan.modelId,
            reasoningEffort: plan.reasoningEffort,
          },
          context().participants.map((row) => row.agentId),
        )
      } else {
        await store.setModelSelection(
          sessionId,
          plan.connectionId,
          plan.modelId,
          plan.reasoningEffort,
          plan.agentId,
        )
        const { maxTurns, contextLimit } = plan.settings
        const triple = { agentId: plan.agentId, providerId: plan.providerId, modelId: plan.modelId }
        if (maxTurns !== undefined)
          rememberAgentModelSettings(agentSettingsIo, {
            ...triple,
            maxTurns: maxTurns ?? undefined,
          })
        if (contextLimit !== undefined)
          rememberAgentModelSettings(agentSettingsIo, {
            ...triple,
            contextLimit: contextLimit ?? undefined,
          })
      }
      recordRecentModel({ connectionId: plan.connectionId, modelId: plan.modelId })
    },
    [context, sessionId],
  )

  /** Run a completed `/model` selection here and clear the draft; false hands it to the server. */
  const submit = useCallback(
    (detected: { command: SlashCommand; text: string } | null, clear: () => void): boolean => {
      const { command, text } = detected ?? {}
      if (!sessionId || !command?.args) return false
      let plan: ModelCommandPlan | null = null
      if (isEffortCommand(command)) {
        const resolved = resolveEffortCommand(context(), text ?? '', command.args)
        if ('error' in resolved) {
          toast.message(resolved.error)
          return true
        }
        plan = resolved.plan
      } else if (isModelCommand(command)) {
        plan = resolveModelCommand(context(), text ?? '', command.args)
      }
      if (!plan) return false
      clear()
      void apply(plan).catch(
        plan.kind === 'party'
          ? notifyPartyRouteFailure
          : (error: unknown) =>
              toast.error('Could not switch the model', {
                description: errorMessage(error, 'Try again.'),
              }),
      )
      return true
    },
    [apply, context, sessionId],
  )

  return useMemo(() => ({ loadOptions, skipArg, submit }), [loadOptions, skipArg, submit])
}
