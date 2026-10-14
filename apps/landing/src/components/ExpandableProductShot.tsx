import { homeShots } from '../generated/home-shots'
import { ProductShot } from './ProductShot'
import { Screenshot } from './Screenshot'

export function ExpandableProductShot({
  shot,
  alt,
  title,
}: {
  shot: string
  alt: string
  title: string
}) {
  const entry = homeShots[shot]
  if (!entry || entry.placeholder) return <ProductShot shot={shot} alt={alt} />
  return (
    <Screenshot src={entry.src} alt={alt} title={title}>
      <ProductShot shot={shot} alt={alt} className="screenshot-thumbnail border-0" />
    </Screenshot>
  )
}
