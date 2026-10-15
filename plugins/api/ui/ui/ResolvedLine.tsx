import { AlertTriangle, CornerDownRight } from 'lucide-react'
import { Chip } from '@localixai/kit/chip'
import type { ResolvedPreview } from '../../backend/contracts'

/**
 * What a templated url actually resolves to, under the environment that is active right now.
 * The url bar shows the TEMPLATE (that is what is saved and portable); a person about to press
 * Send needs the destination too. The gap between the two IS environments, so both are shown.
 */
export function ResolvedLine({ resolved }: { resolved: ResolvedPreview }) {
  if (resolved.missing.length > 0) {
    return (
      <div className="flex items-center gap-2 border-b border-border-soft px-3 py-1.5 text-2xs">
        <AlertTriangle className="size-3.5 shrink-0 text-status-warning" />
        <span className="min-w-0 flex-1">
          {resolved.environment
            ? `“${resolved.environment}” does not define `
            : 'No environment is active, so nothing defines '}
          {resolved.missing.map((m) => `{{${m}}}`).join(', ')} — this request will not send.
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 border-b border-border-soft px-3 py-1.5">
      <CornerDownRight className="size-3.5 shrink-0 text-text-faint" />
      <span
        className="min-w-0 flex-1 truncate font-mono text-2xs text-text-faint"
        title={resolved.url}
      >
        {resolved.url}
      </span>
      {resolved.environment && (
        <Chip tone="neutral" className="shrink-0">
          {resolved.environment}
        </Chip>
      )}
    </div>
  )
}
