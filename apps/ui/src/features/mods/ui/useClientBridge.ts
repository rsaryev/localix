import { useEffect, useRef, type RefObject } from 'react'
import { collectHostThemeCss } from '@/shared/lib/hostThemeVars'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { useLatestRef } from '@/shared/lib/useLatestRef'
import type { ModClientFault } from '@/shared/api/modsApi'

/**
 * The host side of a `Client`'s frame. Only messages from this frame's own window count, and each
 * is checked for shape: the frame runs plugin code. A post goes to the API as `ui.message`, one at
 * a time — a later one waiting replaces an earlier one, as the frame's own once-per-frame rule
 * does — and props a hook answers go back to the frame without a redraw. Each drawing of the pane
 * hands the frame its props again, and the app's theme follows it while it runs.
 */

const PHASES = new Set(['load', 'render', 'run'])
const SAFE_HREF = /^(https?:|mailto:)/i

export const currentTheme = (): 'light' | 'dark' =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'

export function useClientBridge(input: {
  frame: RefObject<HTMLIFrameElement | null>
  /** Changes with each drawing of the pane: the props are handed again. */
  generation: number
  props: unknown
  post: (data: unknown) => Promise<{ props?: unknown }>
  onFault: (fault: ModClientFault) => void
  onSize: (size: { width: number; height: number }) => void
}) {
  const latest = useLatestRef(input)
  const ready = useRef(false)

  const toFrame = (type: string, payload?: unknown) =>
    input.frame.current?.contentWindow?.postMessage({ lx: 'mod-client', type, payload }, '*')
  const toFrameRef = useLatestRef(toFrame)

  useEffect(() => {
    let inflight = false
    let waiting: { data: unknown } | null = null
    const deliver = (data: unknown) => {
      inflight = true
      latest.current
        .post(data)
        .then((answer) => {
          if (answer.props !== undefined) toFrameRef.current('props', answer.props)
        })
        .catch(() => {})
        .finally(() => {
          inflight = false
          const next = waiting
          waiting = null
          if (next) deliver(next.data)
        })
    }
    const onMessage = (event: MessageEvent) => {
      const frame = latest.current.frame.current
      const data = event.data as { lx?: unknown; type?: unknown; payload?: unknown } | null
      if (!frame || event.source !== frame.contentWindow || data?.lx !== 'mod-client') return
      const payload = data.payload as Record<string, unknown> | undefined
      if (data.type === 'ready') {
        ready.current = true
        toFrameRef.current('props', latest.current.props)
        toFrameRef.current('theme', { theme: currentTheme(), css: collectHostThemeCss() })
      } else if (data.type === 'post') {
        if (inflight) waiting = { data: payload }
        else deliver(payload)
      } else if (data.type === 'fault' && payload && PHASES.has(String(payload.phase))) {
        latest.current.onFault({
          phase: payload.phase as ModClientFault['phase'],
          reason: String(payload.reason ?? '').slice(0, 4096),
        })
      } else if (data.type === 'size' && payload) {
        const width = Number(payload.width)
        const height = Number(payload.height)
        if (Number.isFinite(width) && Number.isFinite(height))
          latest.current.onSize({
            width: Math.min(Math.max(width, 0), 4000),
            height: Math.min(Math.max(height, 0), 4000),
          })
      } else if (data.type === 'open' && payload) {
        // A link the person pressed in the frame: only while they are in it, only to the web.
        const href = String(payload.href ?? '')
        // Plugin code asked, so the person confirms the handoff, as for any untrusted link.
        if (document.activeElement === frame && SAFE_HREF.test(href))
          void platformCapabilities().external.requestOpen(href, false)
      } else if (data.type === 'escape') {
        frame.blur()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [latest, toFrameRef])

  // Every drawing hands the running instance its props, its state kept.
  useEffect(() => {
    if (ready.current) toFrameRef.current('props', latest.current.props)
  }, [input.generation, latest, toFrameRef])

  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (ready.current)
        toFrameRef.current('theme', { theme: currentTheme(), css: collectHostThemeCss() })
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [toFrameRef])
}
