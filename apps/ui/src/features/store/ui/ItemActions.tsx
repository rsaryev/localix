import { useState } from 'react'
import type { ActionResult, ItemAction } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'

/**
 * What else can be done with an install, beside saving its settings: the buttons its provider
 * declares (Test connection, Sign in, Sign out). Running one says what happened beside the
 * buttons, opens an address the provider hands back, and lets the page read the settings again.
 */
export function ItemActions({
  actions,
  run,
  onDone,
}: {
  actions: readonly ItemAction[]
  run: (action: string) => Promise<ActionResult>
  onDone: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
  if (actions.length === 0) return null
  const start = async (action: ItemAction) => {
    if (busy) return
    setBusy(action.id)
    setSaid(null)
    try {
      const result = await run(action.id)
      if (result.open) platformCapabilities().external.open(result.open, true)
      setSaid(result.message ? { ok: result.ok, text: result.message } : null)
    } catch (error) {
      setSaid({ ok: false, text: errorMessage(error, `${action.label} did not work`) })
    } finally {
      setBusy(null)
      onDone()
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {actions.map((action) => (
        <Button
          key={action.id}
          variant="field"
          size="lg"
          disabled={busy !== null}
          aria-busy={busy === action.id}
          title={action.help}
          className={action.danger ? 'text-status-error' : undefined}
          onClick={() => void start(action)}
        >
          {action.label}
        </Button>
      ))}
      {said && (
        <p
          role={said.ok ? 'status' : 'alert'}
          className={`text-xs ${said.ok ? 'text-text-soft' : 'text-status-error'}`}
        >
          {said.text}
        </p>
      )}
    </div>
  )
}
