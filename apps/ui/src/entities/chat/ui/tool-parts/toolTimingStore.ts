import { createContext, useContext } from 'react'

/**
 * Supplies persisted per-tool durations to `ToolLine` without threading a prop
 * through every item view. `MessageCard` provides the map (keyed by toolCallId);
 * `ItemView` provides the current item's id. `ToolLine` reads both and resolves
 * its own duration.
 */
export const DurationsContext = createContext<Map<string, number> | null>(null)
export const CurrentToolCallContext = createContext<string | undefined>(undefined)

/** Resolve the persisted duration (ms) for the ToolLine currently being rendered. */
export function useToolDuration(): number | undefined {
  const durations = useContext(DurationsContext)
  const toolCallId = useContext(CurrentToolCallContext)
  if (!durations || !toolCallId) return undefined
  return durations.get(toolCallId)
}
