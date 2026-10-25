import { ResearchSection } from './ResearchSection'
import { ContextExclusionsSection } from './ContextExclusionsSection'

/** Global access and context policies never depend on the selected capability agent. */
export function ContextSettings() {
  return (
    <div className="space-y-8">
      <ResearchSection />
      <ContextExclusionsSection />
    </div>
  )
}
