import { cn } from '@/lib/cn'
import { ProductShot } from './ProductShot'

const videoUrl = import.meta.env.VITE_PRODUCT_VIDEO_URL?.trim()
const posterUrl = import.meta.env.VITE_PRODUCT_VIDEO_POSTER_URL?.trim()

/**
 * The hero's media: the walkthrough video when one is configured, otherwise the workspace capture.
 * Both are 16:10 or 16:9 boxes sized before they load, so the page below never shifts.
 */
export function ProductVideo({ className }: { className?: string }) {
  if (videoUrl) {
    return (
      <video
        className={cn(
          'aspect-video w-full rounded-2xl border border-border-subtle bg-card object-cover',
          className,
        )}
        controls
        playsInline
        preload="metadata"
        poster={posterUrl || undefined}
      >
        <source src={videoUrl} />
      </video>
    )
  }

  return (
    <ProductShot
      shot="workspace/hero"
      alt="Localix workspace: editor, terminal, preview and the agent session side by side"
      priority
      className={className}
    />
  )
}
