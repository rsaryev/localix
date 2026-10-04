/**
 * Server-owned liveness for preview endpoints, pushed to the workspace over the socket.
 *
 * The pane used to answer this itself, with a `no-cors` GET at the preview URL every three
 * seconds, from every open tab, forever — real HTTP into the user's own app (waking SSR
 * renders, filling its log), answerable from the browser's cache, and blind to the one fact
 * we already hold: the process serving it just exited.
 *
 * Here the API owns it. One watcher per ENDPOINT for the whole machine
 * ({@link createLivenessRegistry}), a TCP connect rather than a request, and an owner path —
 * the terminal service reports a dev server's death the moment its PTY exits, so the pane
 * learns it in the same tick instead of on the next poll.
 *
 * Only loopback and private addresses may be watched. The url arrives from a client, and a
 * connect to anything it names would make this a port scanner with our network position.
 */
import {
  createLivenessRegistry,
  tcpEndpointOf,
  type LivenessRegistry,
  type LivenessState,
} from '@localixai/liveness'

import { classifyHost } from '../agent-core/tools/preview/served-url-hosts'
import type { WsFrameContribution } from '../ext/ws-frame-registry'

/** Distinct from the reserved s (session) / r (rpc) / n (journal) and plugin tags. */
export const PREVIEW_LIVENESS_FRAME_TAG = 'v'
export const PREVIEW_LIVENESS_SUBSCRIBE = 'preview.liveness.subscribe'
export const PREVIEW_LIVENESS_UNSUBSCRIBE = 'preview.liveness.unsubscribe'

/** One pushed transition, addressed by the url the client subscribed with. */
export interface PreviewLivenessFrame {
  url: string
  /** False when this endpoint is not ours to probe — the client keeps its own fallback. */
  watchable: boolean
  /** `null` means not yet known, which is never the same as "down". */
  alive?: boolean | null
  since?: number
  source?: LivenessState['source']
}

export interface PreviewLivenessService {
  /** The shared registry — other features watch their own endpoints through it. */
  registry: LivenessRegistry
  /** Live-stream contributions for the realtime socket. */
  frames: WsFrameContribution[]
  /**
   * An owner's authoritative answer about a url: the process serving it exited, or a
   * listener appeared. Ignored for an endpoint nobody is watching.
   */
  report(url: string, alive: boolean): void
}

/** The identity a preview endpoint is watched under: its host and port, never its path. */
export function previewLivenessKey(url: string): string | null {
  const endpoint = tcpEndpointOf(url)
  if (!endpoint) return null
  const kind = classifyHost(endpoint.host)
  // `custom` (a DNS name) and `public-ip` are refused for the same reason the preview tool
  // refuses to auto-open them: we cannot tell the user's machine from someone else's.
  if (kind !== 'loopback' && kind !== 'private-ip') return null
  return `${endpoint.host}:${endpoint.port}`
}

export function createPreviewLivenessService(
  options: { registry?: LivenessRegistry } = {},
): PreviewLivenessService {
  const registry = options.registry ?? createLivenessRegistry()

  const contribution: WsFrameContribution<{ url?: unknown }, () => void> = {
    subscribeCommand: PREVIEW_LIVENESS_SUBSCRIBE,
    unsubscribeCommand: PREVIEW_LIVENESS_UNSUBSCRIBE,
    frameTag: PREVIEW_LIVENESS_FRAME_TAG,
    // Keyed by the URL the client asked about, so every subscriber's frames carry ITS url and
    // route unambiguously. Sharing happens a layer down: two urls on one host:port resolve to
    // the same watcher, and the endpoint is asked once however many panes are open.
    key: (params) => (typeof params.url === 'string' ? params.url : ''),
    start: (params, send) => {
      const url = typeof params.url === 'string' ? params.url : ''
      const key = previewLivenessKey(url)
      const endpoint = key ? tcpEndpointOf(url) : null
      if (!key || !endpoint) {
        // Answer rather than fail: the client needs to know to fall back, and a rejected
        // subscribe reaches it as a generic protocol error it cannot act on.
        send(JSON.stringify({ url, watchable: false } satisfies PreviewLivenessFrame))
        return () => {}
      }
      return registry.watch(key, { kind: 'tcp', ...endpoint }, (state) => {
        send(
          JSON.stringify({
            url,
            watchable: true,
            alive: state.alive ?? null,
            since: state.since,
            source: state.source,
          } satisfies PreviewLivenessFrame),
        )
      })
    },
    // The frame connection calls this on unsubscribe AND on socket close, so a closed tab
    // releases the watcher; the registry stops probing when the last one leaves.
    stop: (release) => release(),
  }

  return {
    registry,
    frames: [contribution],
    report(url, alive) {
      const key = previewLivenessKey(url)
      if (key) registry.report(key, alive)
    },
  }
}
