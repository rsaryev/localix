import { API_BASE_URL, apiFetch } from '@/shared/api/internal'
import { dropHostDuplicates, hostRuleTexts } from './miniAppStyleDedupe'
import type { MiniAppUiArtifact } from './miniAppUiRuntime'

/**
 * A mini app artifact's URLs and stylesheets: where the host fetches one revision of an artifact
 * from, and how its sheets are attached to the page. Split from `miniAppUiDiscovery.ts`, which
 * wires the runtime; this module knows only the document and the API origin.
 */

/** An artifact URL at one revision, against the API origin the rest of the client uses. */
export function artifactUrl(path: string, revision: string): string {
  const url = new URL(path, API_BASE_URL || window.location.origin)
  url.searchParams.set('v', revision)
  return url.href
}

/**
 * Attach one mini app's sheets and resolve when they applied (or failed: a sheet is not fatal).
 *
 * The Tailwind utilities sheet is fetched and adopted with the host's duplicates removed (see
 * `miniAppStyleDedupe`), so a mini app cannot out-rank the host on the host's own elements. A
 * `<link>` cannot do that: on the desktop the artifact comes from the API's origin, and a
 * cross-origin sheet's rules cannot be read or edited. Only that sheet: an adopted sheet resolves
 * `url()` against the document rather than the artifact, which a component's own CSS (fonts,
 * images) may rely on, and only the utilities duplicate the host. Where adoption is unavailable or
 * the fetch fails, the sheet falls back to a plain link — the mini app still renders with its old
 * precedence.
 */
export async function mountStyles(artifact: MiniAppUiArtifact): Promise<() => void> {
  const utilities = artifact.styles.filter(isUtilitiesSheet)
  const own = artifact.styles.filter((style) => !isUtilitiesSheet(style))
  const unmounts = await Promise.all([
    linkStyles(artifact, own),
    ...utilities.map((style) => adoptDeduplicated(artifact, style)),
  ])
  return () => unmounts.forEach((unmount) => unmount())
}

/**
 * The sheet `ui-build.ts` writes the mini app's host-themed Tailwind utilities to. The snapshot
 * carries it as the full path the API serves it at, so it is matched by its file name.
 */
const isUtilitiesSheet = (style: string) => style.split(/[?#]/u)[0].endsWith('/utilities.css')

async function adoptDeduplicated(artifact: MiniAppUiArtifact, style: string): Promise<() => void> {
  if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) {
    return linkStyles(artifact, [style])
  }
  try {
    const response = await apiFetch(artifactUrl(style, artifact.revision))
    if (!response.ok) throw new Error(`${style}: HTTP ${response.status}`)
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(await response.text())
    dropHostDuplicates(sheet, hostRuleTexts(Array.from(document.styleSheets)))
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((each) => each !== sheet)
    }
  } catch {
    return linkStyles(artifact, [style])
  }
}

function linkStyles(artifact: MiniAppUiArtifact, styles: readonly string[]): Promise<() => void> {
  const links = styles.map((style) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = artifactUrl(style, artifact.revision)
    link.dataset.miniApp = artifact.name
    return link
  })
  const applied = links.map(
    (link) =>
      new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true })
        link.addEventListener('error', () => resolve(), { once: true })
      }),
  )
  document.head.append(...links)
  return Promise.all(applied).then(() => () => links.forEach((link) => link.remove()))
}
