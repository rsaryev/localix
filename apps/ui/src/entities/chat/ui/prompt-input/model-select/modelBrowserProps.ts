import type { CatalogModel } from '@localixai/agent/catalog'
import type { ReasoningEffort } from '../../../model/reasoning'
import type { useConnections } from '../useConnections'
import type { ConversationAgentRow } from './ModelTaskColumn'

export interface ModelBrowserProps {
  /** Catalog models (+ any caller-supplied extras). Live per-connection models are discovered here. */
  models: CatalogModel[]
  connectionsState: ReturnType<typeof useConnections>
  /** Current session model + its connection — drives the checkmark and the task summary. */
  sessionModelId: string
  sessionConnectionId: string | null
  /**
   * Assign the model. Chat re-routes the conversation's agent; onboarding and the agent editor
   * have no conversation, so they ignore `agentId` and remember the pair.
   */
  onPickSessionModel: (
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
    agentId?: string,
  ) => void | Promise<void>
  /** Current session effort; before a session exists, the browser falls back to low. */
  reasoningEffort?: ReasoningEffort
  /** `agentId` names whose effort this is: the conversation's agent, or absent for a workload. */
  onReasoningEffortChange?: (effort: ReasoningEffort, agentId?: string) => void
  /** Height utility classes for the Command container. */
  heightClassName?: string
  /** Optional activation-only seed supplied by a UI location. */
  initialQuery?: string
  /** Prefer a connected or connectable provider when the picker opens. */
  initialProviderId?: string
  initialConnectionId?: string
  /** Open on this workload's row instead of the conversation's. */
  initialWorkload?: string
  /**
   * Show the "For which task" column. Off when the browser picks a model for something that
   * is NOT a workload route — an agent definition, say — where a click on another task row
   * would silently rewrite the user's live routing from inside an unrelated form.
   */
  taskColumn?: boolean
  /**
   * The open conversation's agent: it gets a row in the workload column, and picking a model there
   * routes it.
   *
   * Absent where there is no conversation (onboarding, the agent editor): the column then shows
   * the workload catalog alone.
   */
  agent?: ConversationAgentRow
  /** Close the picker: a link that takes the person elsewhere (Settings) dismisses it first. */
  onDismiss?: () => void
}
