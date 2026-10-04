import { createContext, useContext } from 'react'

/**
 * Identity of the tool call whose card is currently being rendered — provided
 * by `ItemView` for every tool-backed item so `ToolLine` (the shared card
 * header) can arm a composer drag (`@call:<toolCallId>` context-ref) without
 * threading a prop through every card component.
 */
export interface ToolCallDragRef {
  toolCallId: string
  name: string
}

export const ToolCallDragContext = createContext<ToolCallDragRef | null>(null)
export const useToolCallDragRef = () => useContext(ToolCallDragContext)
