import type { ReactNode } from 'react'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { Skeleton } from '@localixai/kit/skeleton'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { ControlSet } from './GalleryControls'
import { SurfaceSet } from './GallerySurfaces'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold text-text-strong">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Dev-only: every kit primitive and raised surface in every state on one page, over whatever the
 * window shows — the glass on a Mac, the solid ground elsewhere. The page paints no ground of its
 * own, so the first section sits on the chrome itself; the second sits on a pane's coat, the way
 * controls do inside the workspace. Capture it with the forced states the harness applies (see
 * `data-gallery-state` in GalleryControls).
 */
export function KitGalleryPage() {
  return (
    <main className="flex min-h-dvh flex-col gap-8 p-8 text-foreground">
      <Section title="On the window (chrome)">
        <ControlSet />
      </Section>
      {/* pane-ground-allow: the gallery shows controls on a pane's coat; it is not a pane. */}
      <div className="rounded-xl bg-background p-4">
        <Section title="In a pane">
          <ControlSet />
        </Section>
      </div>
      <Section title="Raised surfaces">
        <SurfaceSet />
      </Section>
      <Section title="Feedback">
        <WorkbenchNoticeBar tone="warning" title="Provider unreachable" description="Retrying." />
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-40" />
          <EmptyHint>No sessions yet</EmptyHint>
        </div>
      </Section>
    </main>
  )
}
