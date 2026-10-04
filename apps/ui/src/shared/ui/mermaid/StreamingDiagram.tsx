import { createContext, useContext } from 'react'
import { DiagramPending, MermaidDiagram } from './MermaidDiagram'

/**
 * The body of the fence a streaming message currently ends inside (`openFenceBody`), or null.
 * Provided by the markdown body per parse; read by the streaming diagram block below.
 */
export const GrowingFenceContext = createContext<string | null>(null)

/**
 * A ```mermaid fence inside a message that is still streaming.
 *
 * Waiting for the whole reply to settle meant a finished diagram sat as raw source for as long
 * as the model kept writing prose after it, and the reader took it for broken output. Only the
 * fence still being written is incomplete — it is always the last one — so every other diagram
 * is drawn at once, and the growing one holds its place as a pending frame.
 */
export function StreamingDiagram({ source }: { source: string }) {
  const growing = useContext(GrowingFenceContext)
  return isGrowingFence(growing, source) ? <DiagramPending /> : <MermaidDiagram source={source} />
}

/** Whether a fence's source is the unterminated tail's body (the stabilizer closed it for display). */
export function isGrowingFence(growing: string | null, source: string): boolean {
  return growing !== null && growing.trimEnd() === source.trimEnd()
}
