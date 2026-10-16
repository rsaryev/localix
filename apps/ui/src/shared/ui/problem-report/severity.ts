import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import type { ComponentType } from 'react'
import type { ProblemSeverity } from '@localixai/plugin-sdk/ui/problems'

/**
 * One glyph and one colour per severity, for the whole app.
 *
 * Before this table the Problems panel, the board diagnostics strip and the Event Center each chose
 * their own icon for "error", so the same fact looked like three different facts. The mapping is
 * data, not a component, so whatever produced the severity — an LSP number a producer has already
 * classified, a plugin's string — lands on one glyph.
 */
export interface SeverityPresentation {
  Icon: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>
  /** Foreground token for the glyph. Text stays `text-foreground`: colour marks, it does not shout. */
  color: string
  label: string
}

export const PROBLEM_SEVERITY: Record<ProblemSeverity, SeverityPresentation> = {
  error: { Icon: CircleAlert, color: 'text-status-error', label: 'Error' },
  warning: { Icon: TriangleAlert, color: 'text-status-warning', label: 'Warning' },
  info: { Icon: Info, color: 'text-status-info', label: 'Info' },
}
