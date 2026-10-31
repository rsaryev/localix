/**
 * Whether the native page is leaving: a navigation is about to replace this document. The host
 * cannot always tell (off macOS the shell reports only loads it started), and a command's reply
 * is written before the next document commits. The page knows first, in these ways, all passive
 * (nothing here cancels, confirms or delays anything the person or the site does):
 *
 * - the Navigation API reports a navigation to another document (not a hash jump, a history
 *   push or a download);
 * - a link click or a form submit that nothing cancelled, listened for on `window` so the page's
 *   own handlers have run first;
 * - `beforeunload`, as the fallback where the above are absent.
 *
 * The signal fades after `LEAVING_MS`: a download or a 204 answer unloads nothing, so it must not
 * hold commands until the next page.
 */

export const LEAVING_MS = 3000

interface NavigateLike {
  destination?: { sameDocument?: boolean }
  hashChange?: boolean
  downloadRequest?: string | null
}

export function trackLeaving(
  win: Window,
  navigation: EventTarget | undefined | null,
  now: () => number = () => Date.now(),
): () => boolean {
  let leftAt = Number.NEGATIVE_INFINITY
  const left = () => {
    leftAt = now()
  }
  win.addEventListener('beforeunload', left)
  navigation?.addEventListener('navigate', (event) => {
    const nav = event as unknown as NavigateLike
    if (!nav.destination?.sameDocument && !nav.hashChange && nav.downloadRequest == null) left()
  })
  win.addEventListener('click', (event) => {
    if (event.defaultPrevented) return
    const target = event.target as Element | null
    const link = target?.closest?.('a[href]') as HTMLAnchorElement | null | undefined
    if (!link || link.hasAttribute('download')) return
    const targetName = (link.getAttribute('target') ?? '').toLowerCase()
    if (targetName && targetName !== '_self') return
    try {
      const to = new URL(link.href, win.location.href)
      if (!/^https?:$/.test(to.protocol)) return
      if (to.href.split('#')[0] !== win.location.href.split('#')[0]) left()
    } catch {
      /* an address that does not parse leaves nowhere */
    }
  })
  win.addEventListener('submit', (event) => {
    if (!event.defaultPrevented) left()
  })
  return () => now() - leftAt < LEAVING_MS
}
