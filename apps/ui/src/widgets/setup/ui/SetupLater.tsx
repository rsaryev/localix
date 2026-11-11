import type { ReactNode } from 'react'
import { TextAction } from '@localixai/kit/text-action'
import { inspector } from '@/shared/lib/inspectorBus'
import { closeSetup } from '@/shared/lib/setupDialog'
import { navigateSettings } from '@/shared/lib/settingsNavBus'

/**
 * A link to the Settings page that owns a step's choices. Setup closes first (keeping its step, so
 * the palette reopens it there): Settings opens in the workspace behind the dialog.
 */
export function SettingsLink({
  tab,
  anchor,
  children,
}: {
  tab: string
  anchor?: string
  children: ReactNode
}) {
  return (
    <TextAction
      className="text-text-soft underline underline-offset-2 hover:text-foreground"
      onClick={() => {
        closeSetup()
        // Open first, then navigate: `navigateSettings` latches its target for the panel.
        inspector.openSettings()
        navigateSettings(tab, anchor)
      }}
    >
      Settings → {children}
    </TextAction>
  )
}

/** Where a step's choices live after setup: the last line of every step. */
export function SetupLater({ children }: { children: ReactNode }) {
  return <p className="pt-4 text-xs leading-5 text-text-faint text-pretty">Later: {children}</p>
}
