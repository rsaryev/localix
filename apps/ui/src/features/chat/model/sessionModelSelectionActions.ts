import type { UiSession } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { agentRoute, sessionRoute, withRoute } from '@/shared/api/contracts'
import { systemNotices } from './systemNotices'
import { rememberSeatEffort, seatProviderId } from './seatEffortMemory'
import type { ReasoningEffort } from './reasoning'
import { patchSessionById } from './sessionListHelpers'
import { findSessionInState } from './findSession'
import type { ChatStore, CustomSet } from './store'
import type { SessionActions } from './sessionActionsSlice'
import { createApplyPartyRoute } from './sessionPartyRoute'
import { choiceFor, withModelChoices } from './sessionModelChoices'
import { applyServerSession } from './sessionSync'

/** The per-session model/effort actions of the chat store, sharing one ordered write lane. */
export function createModelSelectionActions({
  customSet,
  get,
}: {
  customSet: CustomSet
  get: () => ChatStore
}): Pick<SessionActions, 'setModelSelection' | 'setReasoningEffort' | 'applyPartyRoute'> {
  // One ordered persistence lane per chat. The picker remains optimistic, but
  // quick A→B selections reach the backend in that same order and a late A
  // response can never paint over B.
  const modelSelectionWriteTail = new Map<string, Promise<UiSession>>()

  const recordEffort = (
    agentId: string,
    connectionId: string | null,
    modelId: string,
    effort: ReasoningEffort,
  ) => {
    const providerId = seatProviderId(get().connections, connectionId, modelId)
    if (providerId) rememberSeatEffort({ agentId, providerId, modelId, effort })
  }

  const setModelSelection: SessionActions['setModelSelection'] = async (
    sessionId,
    connectionId,
    modelId,
    reasoningEffort,
    agentId,
  ) => {
    const previous = findSessionInState(get(), sessionId)
    // Whom the choice is for. Resolved once, here, so the optimistic paint, the rollback and
    // the request all name the same participant even if the party changes mid-flight.
    const target = agentId ?? (previous ? sessionRoute(previous).agentId : undefined)
    const previousRoute = previous && target ? agentRoute(previous, target) : undefined
    // An agent not invited yet has no seat: the pick is the session's choice for it, which it
    // joins on (`sessionModelChoices.ts`).
    const seated = Boolean(previousRoute)
    // Model selection is interaction state: paint it synchronously. Waiting for
    // the PATCH response left a newly-created cross-scope chat displaying its
    // previous/null connection, even though the backend had already persisted
    // the choice. Roll back only if this exact optimistic pair is still current.
    const picked = {
      providerConnectionId: connectionId,
      modelId,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    }
    customSet((state) =>
      patchSessionById(state, sessionId, (session) => {
        const routed = withRoute(session, picked, target)
        return target ? withModelChoices(routed, [{ agentId: target, ...picked }]) : routed
      }),
    )

    const persist = () =>
      backendClient.updateSession(sessionId, {
        route: {
          ...(target ? { agentId: target } : {}),
          providerConnectionId: connectionId,
          modelId,
          ...(reasoningEffort ? { reasoningEffort } : {}),
        },
      })
    const previousWrite = modelSelectionWriteTail.get(sessionId)
    const write = previousWrite ? previousWrite.then(persist, persist) : persist()
    modelSelectionWriteTail.set(sessionId, write)

    let session: UiSession
    let latest = false
    try {
      session = await write
      latest = modelSelectionWriteTail.get(sessionId) === write
    } catch (error) {
      if (!seated && previous && modelSelectionWriteTail.get(sessionId) === write) {
        customSet((state) =>
          patchSessionById(state, sessionId, (current) => ({
            ...current,
            modelChoices: previous.modelChoices,
          })),
        )
      }
      if (previousRoute && target && modelSelectionWriteTail.get(sessionId) === write) {
        customSet((state) =>
          patchSessionById(state, sessionId, (current) => {
            const now = agentRoute(current, target)
            if (!now || now.providerConnectionId !== connectionId || now.modelId !== modelId)
              return current
            return withRoute(
              current,
              {
                providerConnectionId: previousRoute.providerConnectionId,
                modelId: previousRoute.modelId,
                ...(reasoningEffort && now.reasoningEffort === reasoningEffort
                  ? { reasoningEffort: previousRoute.reasoningEffort }
                  : {}),
              },
              target,
            )
          }),
        )
      }
      throw error
    } finally {
      if (modelSelectionWriteTail.get(sessionId) === write) {
        modelSelectionWriteTail.delete(sessionId)
      }
    }

    // Every level a seat gets is the level remembered for that agent on that model.
    if (target && modelId && reasoningEffort)
      recordEffort(target, connectionId, modelId, reasoningEffort)
    // A newer choice may change only effort on the same model/connection. Pair equality
    // cannot detect that, so only the last write is allowed to replace the session snapshot.
    if (!latest) return
    if (!seated) {
      applyServerSession(session)
      return
    }
    const current = findSessionInState(get(), sessionId)
    const currentRoute = current && target ? agentRoute(current, target) : undefined
    if (
      currentRoute &&
      target &&
      currentRoute.providerConnectionId === connectionId &&
      currentRoute.modelId === modelId
    ) {
      // A reasoning change can race the model PATCH. Keep that newer effort
      // instead of allowing this response to repaint an older snapshot.
      applyServerSession(
        currentRoute.reasoningEffort !== reasoningEffort && reasoningEffort !== undefined
          ? withRoute(session, { reasoningEffort: currentRoute.reasoningEffort }, target)
          : session,
      )
      // The choice is not copied into the browser. Writing it to the seat IS the record —
      // the server reads the freshest non-blank seat back as the `recent` level of the model
      // chain (`repository-recent-routes.ts`), so a second copy here could only disagree
      // with it, and would outlive the database that holds the original.
      // The model line is the server's too, for the same reason as the effort's: it names the
      // participant and the agents read it. The CONNECTION line stays here — which credentials
      // a model is reached through is an account fact the conversation cannot act on, so it is
      // shown to the person and to nobody else.
      if (previousRoute?.providerConnectionId !== connectionId) {
        get()._addSystemNotice(
          sessionId,
          systemNotices.connectionChange(
            get().connections.find((connection) => connection.id === connectionId)?.label ??
              'connection',
          ),
        )
      }
    }
  }

  const setReasoningEffort: SessionActions['setReasoningEffort'] = async (
    sessionId,
    reasoningEffort,
    forAgentId,
  ) => {
    // No notice is drawn here. The server writes the line — naming the participant, and as a
    // row the AGENTS read too (`session-notice.ts`); a second, client-only copy would print
    // the same event twice and disagree with it about who it was about.
    // Effort travels with the model, so it re-routes a participant rather than the session.
    // WHOSE effort is the caller's to say — the picker configures one named member, the
    // compact control beside the composer speaks for the conversation and so for its first one.
    const target = findSessionInState(get(), sessionId)
    const agentId = forAgentId ?? (target ? sessionRoute(target).agentId : undefined)
    // A seat, else — for an agent not invited yet — the session's choice for it.
    const route =
      target && agentId
        ? (agentRoute(target, agentId) ?? choiceFor(target.modelChoices, agentId))
        : undefined
    if (!route?.modelId || !agentId) return
    if (!route.providerConnectionId) {
      // A seat whose model names no connection yet (the run binds one) still takes the level:
      // write the effort alone instead of dropping the choice.
      customSet((state) =>
        patchSessionById(state, sessionId, (session) =>
          withModelChoices(withRoute(session, { reasoningEffort }, agentId), [
            { agentId, reasoningEffort },
          ]),
        ),
      )
      await backendClient.updateSession(sessionId, { route: { agentId, reasoningEffort } })
      recordEffort(agentId, null, route.modelId, reasoningEffort)
      return
    }
    // A separate reasoning PATCH could overtake a model pick and replace its optimistic
    // route with an older response. Use the same ordered lane and rollback for both controls.
    await setModelSelection(
      sessionId,
      route.providerConnectionId,
      route.modelId,
      reasoningEffort,
      agentId,
    )
  }

  // The whole room at once rides the same lane, so it cannot overtake a per-member pick.
  const applyPartyRoute = createApplyPartyRoute({
    customSet,
    get,
    lane: modelSelectionWriteTail,
  })

  return { setModelSelection, setReasoningEffort, applyPartyRoute }
}
