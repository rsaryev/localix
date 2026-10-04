import { openExternal } from './openExternal'
import { requestConfirmation } from './confirmAction'

/**
 * Opening a link, expressed as a {@link ConfirmableAction}.
 *
 * This file knows what a URL is; `confirmAction.ts` owns the asking and
 * `openExternal.ts` owns the OS handoff. Keeping the three apart is what stops
 * the confirmation from being link-shaped forever: the next outward action
 * describes itself the same way and inherits the same host, the same
 * no-host guarantee and the same single question on screen.
 *
 * `platformCapabilities().external.open` delegates here, and that port is already
 * the one choke point every layer reaches — plugins through `pluginExternal`,
 * plus the reader, terminal links, rendered Markdown, `ExternalAnchor`, the
 * preview toolbar and the OAuth flows.
 */

function describe(url: string): { title: string; confirmLabel: string } {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'mailto:') {
      return { title: 'Open your mail app?', confirmLabel: 'Open' }
    }
    if (parsed.protocol === 'tel:') return { title: 'Start a call?', confirmLabel: 'Call' }
    return {
      title: parsed.host ? `Open ${parsed.host}?` : 'Open this link?',
      confirmLabel: 'Open in browser',
    }
  } catch {
    // Unparseable here is not a refusal — `openExternal` and the native command
    // both validate again. The question just loses its headline.
    return { title: 'Open this link?', confirmLabel: 'Open' }
  }
}

/**
 * The person's own machine. Opening a dev server or the embedded API in a browser is not
 * "leaving the app for somewhere", so there is nothing to confirm — the question was only
 * ever about handing a person to a site they may not have chosen.
 */
function isLocalHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    return (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
      /^192\.168\.\d+\.\d+$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname)
    )
  } catch {
    return false
  }
}

/** Ask, then hand the URL to the OS browser. The default for every layer. */
export function confirmAndOpenExternal(url: string): void {
  if (isLocalHost(url)) {
    openExternal(url)
    return
  }
  const { title, confirmLabel } = describe(url)
  requestConfirmation({
    kind: 'external-link',
    title,
    // The FULL url, not the host: the person is about to leave the app and
    // deserves to see exactly where to.
    detail: url,
    confirmLabel,
    cancelLabel: 'Stay here',
    variant: 'default',
    perform: () => openExternal(url),
  })
}
