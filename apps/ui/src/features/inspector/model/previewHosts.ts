import { create } from 'zustand'
import { workspaceOf } from '@/shared/lib/workspaceOf'

// Keyed by the workspace whose strip holds the tab (`previewStore`), so the reveal that names the
// sub-session which opened it and the strip that holds it agree on one key.
export const previewHostKey = (sessionId: string, previewId: string) =>
  JSON.stringify([workspaceOf(sessionId), previewId])

/**
 * Which tabs have a renderer off screen. A tab the person is not looking at is hosted only while an
 * agent is using it: opened or commanded during a run, released when that run ends. The visible
 * tab is the pane's own (`foreground`) and is never released here. Persisted history boots nothing.
 */
export const usePreviewHosts = create<{
  live: Record<string, boolean>
  foreground: Record<string, number>
  opened: (key: string) => void
  closed: (key: string) => void
  attach: (key: string) => () => void
  /** Drop every off-screen host of one workspace; answers the released tab IDs. */
  releaseWorkspace: (workspace: string) => string[]
}>((set, get) => ({
  live: {},
  foreground: {},
  opened: (key) => set((s) => ({ live: { ...s.live, [key]: true } })),
  closed: (key) =>
    set((s) => {
      const live = { ...s.live }
      delete live[key]
      return { live }
    }),
  releaseWorkspace: (workspace) => {
    const { live, foreground } = get()
    const released = Object.keys(live).flatMap((key) => {
      const [owner, previewId] = JSON.parse(key) as [string, string]
      return owner === workspace && !foreground[key] ? [{ key, previewId }] : []
    })
    if (released.length) {
      set((s) => {
        const next = { ...s.live }
        for (const { key } of released) delete next[key]
        return { live: next }
      })
    }
    return released.map(({ previewId }) => previewId)
  },
  attach: (key) => {
    set((s) => ({ foreground: { ...s.foreground, [key]: (s.foreground[key] ?? 0) + 1 } }))
    return () =>
      set((s) => {
        const foreground = { ...s.foreground }
        if ((foreground[key] ?? 0) <= 1) delete foreground[key]
        else foreground[key]!--
        return { foreground }
      })
  },
}))
