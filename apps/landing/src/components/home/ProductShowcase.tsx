import { ProductShot } from '../ProductShot'
import { cn } from '../../lib/cn'
import { Mockup, MockupFrame } from './ShowcaseFrame'

/**
 * Adapted from Launch UI's publicly rendered Pro hero, not its unavailable React source.
 * https://www.launchuicomponents.com/docs/sections/hero
 * The three panels keep its stacking order, rotation, skew and hover offsets.
 * Dated product captures automatically replace the existing screenshot slots.
 */
export function ProductShowcase({ className }: { className?: string }) {
  return (
    <div className={cn('product-showcase', className)}>
      <div className="showcase-stack">
        <div className="showcase-panel showcase-side showcase-left" aria-hidden="true">
          <MockupFrame>
            <Mockup>
              <ProductShot shot="project-space/board" alt="" className="rounded-md border-0" />
            </Mockup>
          </MockupFrame>
        </div>
        <div className="showcase-panel showcase-side showcase-middle" aria-hidden="true">
          <MockupFrame>
            <Mockup>
              <ProductShot shot="browser/agent-preview" alt="" className="rounded-md border-0" />
            </Mockup>
          </MockupFrame>
        </div>
        <div className="showcase-panel showcase-main">
          <MockupFrame>
            <Mockup>
              <ProductShot
                shot="workspace/hero"
                alt="Localix workspace: editor, terminal, preview and the agent session side by side"
                priority
                className="rounded-md border-0"
              />
            </Mockup>
          </MockupFrame>
        </div>
      </div>
    </div>
  )
}
