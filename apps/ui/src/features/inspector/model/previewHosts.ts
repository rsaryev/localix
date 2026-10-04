import { create } from 'zustand'
import { workspaceOf } from '@/shared/lib/workspaceOf'

// Keyed by the workspace whose strip holds the tab (`previewStore`), so the reveal that names the
// sub-session which opened it and the strip that holds it agree on one key.
export const previewHostKey = (sessionId: string, previewId: string) =>
  JSON.stringify([workspaceOf(sessionId), previewId])

/** Transient host lifetime; persisted preview history must not boot old servers at startup. */
export const usePreviewHosts = create<{
  live: Record<string, boolean>
  foreground: Record<string, number>
  opened: (key: string) => void
  closed: (key: string) => void
  attach: (key: string) => () => void
}>((set) => ({
  live: {},
  foreground: {},
  opened: (key) => set((s) => ({ live: { ...s.live, [key]: true } })),
  closed: (key) =>
    set((s) => {
      const live = { ...s.live }
      delete live[key]
      return { live }
    }),
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
