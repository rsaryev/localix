import { useState } from 'react'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { API_BASE_URL } from '@/shared/api/internal'

/** A store file's address on this host; the API names it by path. */
export const storeMediaSrc = (path: string) => `${API_BASE_URL}${path}`

/**
 * A mini app's own icon, as the host serves it. Shown through `<img>` only, never inlined, so an
 * SVG from a marketplace is a picture and nothing more. A monogram stands in only when the app has no
 * icon or it does not load. Decorative: the app's name is always written beside it.
 */
export function MiniAppIcon({
  name,
  label,
  icon,
  size,
}: {
  name: string
  label: string
  /** The host path of the icon (`/rpc/mini-apps/…`), when the app has one. */
  icon?: string
  size: number
}) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!icon || failed === icon) return <MonogramAvatar identity={name} label={label} size={size} />
  return (
    <img
      src={storeMediaSrc(icon)}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className="shrink-0 object-contain select-none"
      style={{ width: size, height: size }}
      onError={() => setFailed(icon)}
    />
  )
}
