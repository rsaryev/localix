import { useMemo, type ReactNode } from 'react'
import { assetBindings } from '@localixai/agent'
import type { MessageBinding } from '@/shared/api/contracts'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { mediaSrc } from '@/shared/lib/mediaSrc'
import { attachmentRenderKind, isFigureRender } from '@/shared/lib/attachmentRender'
import { FileChip, FileChipStrip } from '@localixai/kit/file-chip'
import { ImageLightbox, useLightboxPaging } from '@/shared/ui/image-lightbox'
import { VoiceMessage } from '@/shared/ui/attachments/VoiceMessage'
import { ImageFigure, VideoFigure } from './MediaFigure'
import type { MessageContextBindingDraft } from '@localixai/mini-app-sdk/ui'
import { linkFromAttachment } from '../model/contextLinks'
import { linkDragProps } from './linkDrag'

/**
 * Stable render identities for attachments that do not have a universal persisted id.
 *
 * `mediaId` is authoritative when present. Inline/legacy assets fall back to their
 * immutable metadata plus a short content prefix; exact duplicate assets receive an
 * occurrence suffix. Reordering different attachments therefore keeps their React
 * instances and local viewer state attached to the right asset.
 */
export function messageAttachmentKeys(attachments: ReturnType<typeof assetBindings>): string[] {
  const occurrences = new Map<string, number>()
  return attachments.map((attachment) => {
    const source =
      'mediaId' in attachment && attachment.mediaId
        ? `media:${attachment.mediaId}`
        : attachment.kind === 'path'
          ? `path:${attachment.path}:${attachment.name}:${attachment.size}`
          : attachment.kind === 'text'
            ? `text:${attachment.path ?? ''}:${attachment.name}:${attachment.size}:${attachment.text.length}:${attachment.text.slice(0, 64)}`
            : `inline:${attachment.name}:${attachment.size}:${attachment.mediaType}:${attachment.data?.slice(0, 64) ?? ''}`
    const base = `${attachment.kind}:${source}`
    const occurrence = (occurrences.get(base) ?? 0) + 1
    occurrences.set(base, occurrence)
    return occurrence === 1 ? base : `${base}:duplicate-${occurrence}`
  })
}

/** An attachment that drags as its link (`linkFromAttachment`) while it renders as itself. */
function CarriedAttachment({
  link,
  children,
}: {
  link: MessageContextBindingDraft
  children: ReactNode
}) {
  return <div {...linkDragProps(() => link)}>{children}</div>
}

/**
 * Figures / chips for a message's attachments — user uploads AND mini-app-added
 * deliverables on assistant replies. `align` follows the message side.
 *
 * EVERY image renders as an inline {@link ImageFigure}: a real picture with a
 * caption strip and a hover row (Copy · Save · Expand), clicking it opens the
 * lightbox. The render never depends on who made the image: a screenshot the
 * user pasted deserves the same render as anything else.
 *
 * Non-image, non-video attachments stay compact: the SAME {@link FileChip} the
 * composer tray stages, in read-only mode, in a strip below the figures.
 */
export function MessageAttachments({
  bindings,
  align = 'end',
}: {
  bindings: MessageBinding[]
  align?: 'start' | 'end'
}) {
  const attachments = assetBindings(bindings)
  const attachmentKeys = messageAttachmentKeys(attachments)
  // Flat ordered list of viewable images (plain + generated, in message order),
  // so the lightbox can page ←/→ through every image the message carries.
  const images = useMemo(() => {
    const list: { src: string; name: string; attIndex: number }[] = []
    attachments.forEach((att, i) => {
      if (att.kind === 'image') list.push({ src: mediaSrc(att), name: att.name, attIndex: i })
    })
    return list
  }, [attachments])
  const paging = useLightboxPaging(images)
  const openImage = (attIndex: number) => {
    const pos = images.findIndex((im) => im.attIndex === attIndex)
    if (pos >= 0) paging.open(pos)
  }
  if (attachments.length === 0) return null
  // Several images in one message sit two-up in a responsive grid; a single one
  // keeps its natural width.
  const imageCount = attachments.filter((a) => a.kind === 'image').length
  const gridImages = imageCount > 1

  // Partition by render kind: images and videos render as figures in a wrap;
  // everything else is a compact chip in the strip.
  const figures: ReactNode[] = []
  const chips: ReactNode[] = []
  attachments.forEach((att, i) => {
    const target = isFigureRender(attachmentRenderKind(att)) ? figures : chips
    const key = attachmentKeys[i]!
    if (att.kind === 'image') {
      target.push(<ImageFigure key={key} att={att} grid={gridImages} onZoom={() => openImage(i)} />)
    } else if (att.kind === 'video') {
      target.push(<VideoFigure key={key} att={att} />)
    } else if (att.kind === 'audio') {
      target.push(<VoiceMessage key={key} src={mediaSrc(att)} durationMs={att.durationMs} />)
    } else if (att.kind === 'file') {
      target.push(
        <a key={key} href={mediaSrc(att)} download={att.name}>
          <FileChip kind="file" name={att.name} size={att.size} readonly />
        </a>,
      )
    } else if (att.kind === 'path') {
      target.push(<FileChip key={key} kind="file" name={att.name} size={att.size} readonly />)
    } else {
      // A text attachment carries its content inline (no data URL) — make the
      // chip downloadable as a plain-text file so the content is reachable.
      target.push(
        <a
          key={key}
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(att.text)}`}
          download={att.name}
        >
          <FileChip kind="text" name={att.name} size={att.size} readonly />
        </a>,
      )
    }
    // A stored attachment drags as its link, onto a board or another composer.
    const link = linkFromAttachment(att)
    if (link)
      target.push(
        <CarriedAttachment key={key} link={link}>
          {target.pop()}
        </CarriedAttachment>,
      )
  })

  return (
    <div
      className={cn('mt-1.5 flex flex-col gap-2', align === 'end' ? 'items-end' : 'items-start')}
    >
      {figures.length > 0 && (
        <div
          className={cn('flex flex-wrap gap-2', align === 'end' ? 'justify-end' : 'justify-start')}
        >
          {figures}
        </div>
      )}
      {chips.length > 0 && <FileChipStrip align={align}>{chips}</FileChipStrip>}

      {/* Shared fullscreen viewer — ←/→ pages through the message's images. */}
      <ImageLightbox {...paging.lightbox} />
    </div>
  )
}
