import { createContext, useContext } from 'react'
import type { ToolGateProvenance } from '@localixai/agent/agents'

/**
 * Permission-gate provenance for the CURRENT tool card, provided by ItemView so
 * the shared card header (ToolLine) can explain why a gated call ran without a
 * visible confirm ("session-wide grant", "allow rule", …) — same pattern as
 * toolCallDragContext. Null when the call was a plain default allow.
 */
export const ToolGateContext = createContext<ToolGateProvenance | null>(null)

export function useToolGate(): ToolGateProvenance | null {
  return useContext(ToolGateContext)
}

/** Human-readable one-liner for a gate decision (tooltip text on the shield). */
export function gateLabel(gate: ToolGateProvenance): string {
  switch (gate.decision) {
    case 'user-approved':
      return 'Approved by you'
    case 'session-grant':
      return 'Auto-approved — you allowed this tool for the whole session'
    case 'rule-allow':
      return gate.detail ? `Allowed by rule ${gate.detail}` : 'Allowed by a permission rule'
  }
}
