import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import {
  WorkbenchListRow,
  WorkbenchListRowText,
  WorkbenchListRowMeta,
} from '@localixai/kit/workbench-list-row'
import type { MotionAsset } from '../shared/schema'

export function MediaLibrary({
  assets,
  disabled,
  onRemove,
}: {
  assets: MotionAsset[]
  disabled: boolean
  onRemove: (id: string) => void
}) {
  const [pending, setPending] = useState<MotionAsset | null>(null)
  if (!assets.length) return null
  return (
    <>
      <CollapsibleSection title="Media library" count={assets.length} defaultOpen={false}>
        <p className="mb-2 text-xs text-text-faint">
          Images and audio are shared by your videos. Only unused media can be removed.
        </p>
        {assets.map((asset) => (
          <WorkbenchListRow key={asset.id} density="compact">
            <WorkbenchListRowText title={asset.name} description={asset.kind} />
            <WorkbenchListRowMeta>
              {(asset.bytes / 1024 / 1024).toFixed(1)} MiB
            </WorkbenchListRowMeta>
            <IconButton
              size="xs"
              tooltip="Remove media"
              aria-label={`Remove ${asset.name}`}
              disabled={disabled}
              onClick={() => setPending(asset)}
            >
              <Trash2 />
            </IconButton>
          </WorkbenchListRow>
        ))}
      </CollapsibleSection>
      <ConfirmDialog
        open={pending !== null}
        title="Remove this media file?"
        description="Saved videos are protected: media in use cannot be removed."
        confirmLabel="Remove media"
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending) onRemove(pending.id)
          setPending(null)
        }}
      />
    </>
  )
}
