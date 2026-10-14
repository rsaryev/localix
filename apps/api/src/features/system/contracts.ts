/**
 * Generic, host-level system controls — stateful on/off switches the user flips
 * from the workspace (e.g. "keep this machine awake"). Designed to grow: a new
 * control is one registered toggle; the API + UI stay agnostic and address it by id.
 */
export interface SystemToggleState {
  /** Stable id, e.g. 'keep-awake'. */
  id: string
  /** Short human label for the UI. */
  title: string
  /** One-line description of what flipping it does. */
  description?: string
  /** Current on/off state. */
  enabled: boolean
  /** False when the control isn't supported on this host (e.g. missing OS tool). */
  available: boolean
}
