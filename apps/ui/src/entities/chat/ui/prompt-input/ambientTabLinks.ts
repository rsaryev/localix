/**
 * The composer's AMBIENT auto-links: the grid's open-tab candidates turned into
 * dismissible context refs.
 *
 * Its own module because the GATE is what was wrong and a gate inside a 780-line component
 * is untestable. The reported defect: the chips appeared only once you clicked into the
 * input, because the derivation was gated on `isFocused`. Reading a file leaves the
 * composer unfocused, so the one moment you could see what would be sent was the moment
 * before sending it — and the agent's context depended on where the caret happened to be.
 *
 * VISIBILITY is the right signal, and it is a different question from focus: a warm-hidden
 * composer stays mounted to keep its draft, and THAT is what must derive nothing. Focus is
 * deliberately not a parameter here — there is no way to reintroduce it without changing
 * this signature.
 */
import type { MessageContextBindingDraft } from '@localixai/mini-app-sdk/ui'
import { refFromContextBinding } from '../../model/sendRefs'
import type { AutoRefInput } from '../../model/useContextRefs'

/** A linkable open tab — the structural twin of `ActiveTabLink` (features/workspace-grid). */
export interface AmbientTabLink {
  tabId: string
  /** Canonical opaque binding; never reduce this to a token and re-parse it. */
  binding: MessageContextBindingDraft
  /** Presentation-only compatibility projection. */
  token: string
  label?: string
}

/** Stable empty result — a fresh `[]` would restart the ref preflight debounce every render. */
export const NO_AMBIENT_REFS: AutoRefInput[] = []

const SELECTION_DISMISSAL_PREFIX = 'selection\u0000'

/** Ordinary tabs stay dismissed for the composer lifetime; a live selection is
 * dismissed only while that exact normalized binding remains current. */
export function ambientLinkDismissalKey(link: AmbientTabLink): string {
  if (link.binding.target.attributes?.selection !== true) return link.tabId
  return `${SELECTION_DISMISSAL_PREFIX}${link.tabId}\u0000${JSON.stringify(link.binding.target)}`
}

/** Forget stale selection dismissals once the selection clears or changes. */
export function retainCurrentSelectionDismissals(
  dismissed: ReadonlySet<string>,
  links: readonly AmbientTabLink[] | undefined,
): ReadonlySet<string> {
  const current = new Set<string>()
  for (const link of links ?? []) {
    if (link.binding.target.attributes?.selection === true) {
      current.add(ambientLinkDismissalKey(link))
    }
  }
  const next = new Set<string>()
  let changed = false
  for (const key of dismissed) {
    if (!key.startsWith(SELECTION_DISMISSAL_PREFIX) || current.has(key)) next.add(key)
    else changed = true
  }
  return changed ? next : dismissed
}

/**
 * Turn the grid's candidates (FRESHEST FIRST) into ambient refs, dropping the tabs the user
 * has unlinked and the tokens no ref kind claims. Order is preserved: downstream it is the
 * tie-break between two candidates for the same ref, and the wire order at send.
 */
export function ambientAutoRefs(
  links: readonly AmbientTabLink[] | undefined,
  dismissedLinks: ReadonlySet<string>,
  visible: boolean,
  dismissLink: (key: string) => void,
): AutoRefInput[] {
  if (!visible || !links?.length) return NO_AMBIENT_REFS
  const out: AutoRefInput[] = []
  for (const link of links) {
    const { binding } = link
    const dismissalKey = ambientLinkDismissalKey(link)
    if (dismissedLinks.has(dismissalKey)) continue
    // Resolve from the complete binding so mini-app-owned URI/attributes and the
    // host-minted active-tab provenance survive into the durable message binding.
    const ref = refFromContextBinding(binding)
    out.push({
      ref,
      dismiss: () => dismissLink(dismissalKey),
    })
  }
  return out.length > 0 ? out : NO_AMBIENT_REFS
}
