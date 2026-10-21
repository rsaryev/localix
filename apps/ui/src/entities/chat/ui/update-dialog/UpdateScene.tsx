import { ArrowUp } from 'lucide-react'
import { DialogHero } from '@localixai/kit/dialog-hero'
import { LocalixMark } from '@/shared/ui/LocalixMark'
import './update-scene.css'

/**
 * The update arriving: the kit's stage (`DialogHero`, as every dialog opens) with the app's mark,
 * the arrow badge, and the version rolling from the one running now to the new one.
 */
export function UpdateScene({ from, to }: { from: string; to: string }) {
  return (
    <DialogHero size="lg" icon={<LocalixMark className="size-7" />} badge={<ArrowUp />}>
      <span className="ud-version">
        <span className="ud-version-from">{from}</span>
        <span className="ud-version-to">{to}</span>
      </span>
    </DialogHero>
  )
}
