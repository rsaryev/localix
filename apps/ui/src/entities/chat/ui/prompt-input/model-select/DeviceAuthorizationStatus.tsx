import { Check, Copy } from 'lucide-react'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { ExternalAnchor } from '@/shared/ui/external-anchor'

/** A device-code sign-in in progress (GitHub Copilot): the code to enter, and where. */
export interface DeviceInfo {
  userCode?: string
  verificationUri?: string
}

export function DeviceAuthorizationStatus({
  deviceInfo,
  copied,
  onCopy,
}: {
  deviceInfo: DeviceInfo
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="mt-2 flex flex-col gap-2 border-y border-border-faint py-3">
      <span className="text-2xs leading-snug text-text-soft">
        1. Open{' '}
        {deviceInfo.verificationUri ? (
          <ExternalAnchor
            href={deviceInfo.verificationUri}
            systemBrowser
            className="text-foreground underline underline-offset-2"
          >
            {deviceInfo.verificationUri}
          </ExternalAnchor>
        ) : (
          'the provider verification page'
        )}{' '}
        and enter this code:
      </span>
      <div className="flex items-center gap-2">
        {/* Foreground veil, not `bg-background`: that is the WINDOW ground — denser than the
            popover this form lives in, so the device code read as a black plate on it. */}
        <span className="select-all rounded-md border border-border-soft bg-foreground/[0.06] px-3 py-1.5 font-mono text-base tracking-[0.3em] text-foreground">
          {deviceInfo.userCode}
        </span>
        <Button variant="ghost" size="lg" onClick={onCopy}>
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <span className="inline-flex items-center gap-1.5 text-2xs leading-snug text-text-soft">
        <ActivityOrb className="size-3 text-status-info" />
        Waiting for authorization. The connection appears here automatically once approved.
      </span>
    </div>
  )
}
