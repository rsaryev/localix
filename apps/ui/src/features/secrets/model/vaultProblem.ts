import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { errorDetail } from '@/shared/api/internal'

/**
 * THE VAULT'S ONE VOICE IN THE EVENT CENTER — the scope every Vault surface publishes under,
 * and the shape a caught failure takes on its way there.
 *
 * It lives in its own module because it is shared by things that must not import each other:
 * `useVaultWorkspace` (which owns the list's standing report), and the item and delete dialogs,
 * which publish their own transient rows. A scope constant re-exported from the hook would drag
 * the whole workspace into a dialog's import graph, and a second copy of the string would break
 * the property the scope exists for.
 */

/**
 * Namespace for the Vault's rows in the Event Center. The list's failure is owned by the one
 * hook both surfaces read from: the toolbar line and the empty pane say the same thing, and two
 * publishers of one subject would settle each other's row.
 */
export const VAULT_PROBLEM_SCOPE = 'vault'

/**
 * A thrown failure as the two fields a report has.
 *
 * The Vault used to keep `caught.message` and nothing else, so "the daemon is unreachable" and
 * "this key is in use" arrived as whatever text happened to be on the error, with no record of
 * which of the six calls produced it. `fallback` is the sentence for this operation; the transport
 * has already classified its own failures, and whatever it could not classify stays exact in the
 * detail.
 */
export const vaultFailure = (caught: unknown, fallback: string): Problem => ({
  severity: 'error',
  message: errorMessage(caught, fallback),
  detail: errorDetail(caught),
})
