import { ProductShot } from '@/components/ProductShot'
import { GuideLink } from './cards'

/**
 * Every section below the hero opens on the same block: the lede on one side, the capture that
 * shows it on the other. The capture sits beside the text from `lg` up and under it below, and
 * its 16:10 box is reserved either way.
 */
export function SectionLede({
  eyebrow,
  title,
  children,
  guide,
  shot,
  shotAlt,
}: {
  eyebrow: string
  title: string
  children: React.ReactNode
  guide: { slug: string; label: string }
  shot: string
  shotAlt: string
}) {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-14">
      <div className="max-w-2xl">
        <p className="eyebrow mb-3">{eyebrow}</p>
        <h2 className="section-title text-3xl md:text-4xl">{title}</h2>
        <p className="lede mt-5 text-lg">{children}</p>
        <GuideLink {...guide} />
      </div>
      <ProductShot shot={shot} alt={shotAlt} />
    </div>
  )
}
