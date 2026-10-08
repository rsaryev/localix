import { openExternal } from './openExternal'
import { requestConfirmation } from './confirmAction'

/** The app supplies the Browser workspace opener without coupling shared code to features. */
let openInAppBrowser: ((url: string) => boolean) | null = null

export function registerAppBrowserOpener(open: (url: string) => boolean): () => void {
  const previous = openInAppBrowser
  openInAppBrowser = open
  return () => {
    openInAppBrowser = previous
  }
}

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

/** HTTP links default to the app Browser; true explicitly requests the system browser. */
export function confirmAndOpenExternal(url: string, systemBrowser = false): void {
  let protocol: string | undefined
  try {
    protocol = new URL(url).protocol
  } catch {
    // Leave validation and error reporting for OS handoffs to the existing native command.
  }
  if (
    !systemBrowser &&
    (protocol === 'http:' || protocol === 'https:') &&
    openInAppBrowser?.(url)
  ) {
    return
  }

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
