import type { ReactNode } from 'react'
import { Cpu } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { PickerPanelTitle } from './PickerPanelTitle'

/** The id the API registers the on-this-computer provider under. */
export const LOCAL_PROVIDER_ID = 'local'
/** Local models need no credential; the connection stores this placeholder as its key. */
const LOCAL_CONNECTION_KEY = 'local'

/**
 * Connecting the Local provider: nothing to paste. The connection exists so the picker treats
 * local models like any other provider's; the model server itself is started by the app.
 */
export function LocalConnectPanel({
  nav,
  onAdded,
  onAddApiKey,
}: {
  nav?: ReactNode
  onAdded: () => void
  onAddApiKey: (label: string, apiKey: string) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PanelHeader
        tone="content"
        title={<PickerPanelTitle title="Local" nav={nav} />}
        summary={
          <span className="flex shrink-0 items-center gap-1 text-2xs text-text-faint">
            <Cpu className="size-3" aria-hidden="true" />
            On this computer
          </span>
        }
        actionsLabel="Local connection actions"
      />
      <div className="space-y-3 p-4">
        <p className="max-w-prose text-sm leading-5 text-text-soft text-pretty">
          Run open models on this computer — no key, no account, nothing sent anywhere. Download
          models in Settings → Models; the ones here then appear in this list.
        </p>
        <Button
          variant="mono"
          size="xl"
          onClick={() => {
            onAddApiKey('Local', LOCAL_CONNECTION_KEY)
            onAdded()
          }}
        >
          Use local models
        </Button>
      </div>
    </div>
  )
}
