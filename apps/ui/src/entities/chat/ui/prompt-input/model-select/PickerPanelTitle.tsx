import type { ReactNode } from 'react'
import { SectionLabel } from '@localixai/kit/section-label'
import { cn } from '@localixai/plugin-sdk/ui/classes'

/**
 * A main-panel header title that yields to the narrow layout's navigation.
 *
 * From md up the panel names itself in the canonical `PanelHeader` voice (the same uppercase
 * label the other columns carry). Below md the workload and provider columns are gone, and the
 * header is where you switch them: the nav takes the title's place, because it already names the
 * connection — showing both put the same name on two lines, one above the other.
 */
export function PickerPanelTitle({ title, nav }: { title: string; nav?: ReactNode }) {
  return (
    <>
      {nav != null && (
        <span data-slot="picker-panel-nav" className="flex min-w-0 items-center md:hidden">
          {nav}
        </span>
      )}
      <SectionLabel
        as="span"
        size="xs"
        className={cn(
          'min-w-0 truncate tracking-wide text-text-soft',
          nav != null && 'max-md:hidden',
        )}
      >
        {title}
      </SectionLabel>
    </>
  )
}
