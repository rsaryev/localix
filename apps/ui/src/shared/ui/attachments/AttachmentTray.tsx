import { useMemo } from 'react'
import type { PendingAttachment } from '@/shared/lib/attachment-policy'
import { FileChip, FileChipStrip, RemoveBadge } from '@localixai/kit/file-chip'
import { ImageLightbox, useLightboxPaging } from '@/shared/ui/image-lightbox'
import { VoiceMessage } from '@/shared/ui/attachments/VoiceMessage'

/** A staged voice recording — the player plus a floating remove badge. */
function VoiceChip({
  src,
  durationMs,
  onRemove,
}: {
  src: string
  durationMs?: number
  onRemove: () => void
}) {
  return (
    <div className="group/att relative shrink-0">
      <VoiceMessage src={src} durationMs={durationMs} compact />
      <div className="absolute -right-1.5 -top-1.5">
        <RemoveBadge floating onClick={onRemove} />
      </div>
    </div>
  )
}

export function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[]
  onRemove: (id: string) => void
}) {
  // Flat ordered list of preview-able images in the tray, so the lightbox can
  // page ←/→ through the pending images the composer is holding.
  const images = useMemo(
    () =>
      attachments.flatMap((it) =>
        it.attachment.kind === 'image' && it.previewUrl
          ? [{ id: it.id, src: it.previewUrl, name: it.attachment.name }]
          : [],
      ),
    [attachments],
  )
  const paging = useLightboxPaging(images)
  if (attachments.length === 0) return null
  return (
    <div className="px-3.5 pb-1 pt-2 max-sm:px-2.5">
      <FileChipStrip>
        {attachments.map((item) => {
          const { attachment } = item
          if (attachment.kind === 'audio' && item.previewUrl) {
            return (
              <VoiceChip
                key={item.id}
                src={item.previewUrl}
                durationMs={attachment.durationMs}
                onRemove={() => onRemove(item.id)}
              />
            )
          }
          const chipKind =
            attachment.kind === 'image' ? 'image' : attachment.kind === 'text' ? 'text' : 'file'
          return (
            <FileChip
              key={item.id}
              kind={chipKind}
              name={attachment.name}
              size={attachment.size}
              imageSrc={attachment.kind === 'image' ? item.previewUrl : undefined}
              className="h-12"
              onRemove={() => onRemove(item.id)}
              onView={() => {
                const pos = images.findIndex((im) => im.id === item.id)
                if (pos >= 0) paging.open(pos)
              }}
            />
          )
        })}
      </FileChipStrip>
      <ImageLightbox {...paging.lightbox} />
    </div>
  )
}
