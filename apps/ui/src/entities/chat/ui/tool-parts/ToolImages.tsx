import type { ToolBackedItem } from '@localixai/agent/agents'
import { mediaSrc } from '@/shared/lib/mediaSrc'
import { ImageLightbox, useLightboxPaging } from '@/shared/ui/image-lightbox'
import { IORow } from './ToolIO'

/**
 * The images a tool RETURNED, as the model received them. Without this the expanded card printed
 * the result text, which for a screenshot was the placeholder `[image]` — the user could not see
 * what the agent had looked at. One component for every tool that returns a picture (browser
 * screenshots, an image `read`), because the item field it reads is one field.
 */
export function ToolImages({ item }: { item: ToolBackedItem }) {
  const images = (item.attachments ?? []).flatMap((att) => {
    const src = mediaSrc(att)
    return src ? [{ src, name: att.name }] : []
  })
  const paging = useLightboxPaging(images)
  if (images.length === 0) return null
  return (
    <IORow label="Out">
      <div className="flex flex-wrap gap-2">
        {images.map((image, index) => (
          <button
            key={image.src}
            type="button"
            className="overflow-hidden rounded-md border border-border"
            onClick={() => paging.open(index)}
          >
            <img src={image.src} alt={image.name} className="max-h-48 max-w-full object-contain" />
          </button>
        ))}
      </div>
      <ImageLightbox {...paging.lightbox} />
    </IORow>
  )
}
