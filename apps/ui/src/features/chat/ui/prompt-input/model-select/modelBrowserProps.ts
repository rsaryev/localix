import type { CatalogModel } from '@localixai/agent/catalog'
import type { ReasoningEffort } from '../../../model/reasoning'
import type { useConnections } from '../useConnections'
import type { ParticipantRow } from './ModelTaskColumn'
import type { PartyRouteChoice } from '../../../model/sessionPartyRoute'

export interface ModelBrowserProps {
  /** Catalog models (+ any caller-supplied extras). Live per-connection models are discovered here. */
  models: CatalogModel[]
  connectionsState: ReturnType<typeof useConnections>
  /** Current session model + its connection — drives the checkmark and the task summary. */
  sessionModelId: string
  sessionConnectionId: string | null
  /**
   * Assign the model. Chat closes the drawer and re-routes the participant `agentId` names;
   * onboarding and the agent editor have no party, so they ignore it and remember the pair.
   */
  onPickSessionModel: (
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
    agentId?: string,
  ) => void | Promise<void>
  /** Current session effort; before a session exists, the browser falls back to low. */
  reasoningEffort?: ReasoningEffort
  /**
   * `agentId` names WHOSE effort this is. It used to be absent, so the write always landed on
   * the conversation's first participant however many rows the column showed — in a room, on
   * somebody other than the one being configured.
   */
  onReasoningEffortChange?: (effort: ReasoningEffort, agentId?: string) => void
  /** Height utility classes for the Command container. */
  heightClassName?: string
  /** Optional activation-only seed supplied by a UI location. */
  initialQuery?: string
  /** Prefer a connected or connectable provider when the picker opens. */
  initialProviderId?: string
  initialConnectionId?: string
  /**
   * Show the "For which task" column. Off when the browser picks a model for something that
   * is NOT a workload route — an agent definition, say — where a click on another task row
   * would silently rewrite the user's live routing from inside an unrelated form.
   */
  taskColumn?: boolean
  /**
   * WHO the open conversation is with, in join order. Each becomes a row in the workload
   * column, and picking a model there routes that ONE participant.
   *
   * Empty where there is no conversation (onboarding, the agent editor). The column then shows
   * the workload catalog alone — no branch, because a party is a list and this one has nothing
   * in it.
   */
  participants?: readonly ParticipantRow[]
  /** The participant the picker opens on — the one the composer shows. Absent means the first. */
  initialAgentId?: string | null
  /** Picking a participant row here selects that participant in the composer too. */
  onAgentTargetChange?: (agentId: string) => void
  /**
   * Put every participant on one model and level. Present only where a conversation with a
   * party can take it; absent, the "All agents" row is never offered.
   */
  onApplyPartyRoute?: (choice: PartyRouteChoice) => void | Promise<void>
}
