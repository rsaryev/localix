import { ExpandableProductShot } from '@/components/ExpandableProductShot'
import { GuideLink } from './cards'

/**
 * Every section below the hero opens on the same block: the lede on one side, the capture that
 * shows it on the other. The capture sits beside the text from `lg` up and under it below, and
 * its 16:10 box is reserved either way.
 */
export function SectionLede({
  title,
  children,
  guide,
  shot,
  shotAlt,
}: {
  title: string
  children: React.ReactNode
  guide: { slug: string; label: string }
  shot: string
  shotAlt: string
}) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
      <div className="min-w-0">
        <h2 className="section-title text-3xl md:text-4xl">{title}</h2>
        <p className="lede mt-5 text-lg">{children}</p>
        <GuideLink {...guide} />
      </div>
      <ExpandableProductShot shot={shot} alt={shotAlt} title={title} />
    </div>
  )
}
