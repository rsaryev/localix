import { cn } from '@/lib/cn'
import { ProductShowcase } from './home/ProductShowcase'

const videoUrl = import.meta.env.VITE_PRODUCT_VIDEO_URL?.trim()
const posterUrl = import.meta.env.VITE_PRODUCT_VIDEO_POSTER_URL?.trim()

/**
 * A configured walkthrough takes precedence over the three product captures.
 * Both variants reserve their geometry before the media loads.
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

  return <ProductShowcase className={className} />
}
