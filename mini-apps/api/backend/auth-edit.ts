/**
 * Merging a browser-authored auth block back onto the stored one.
 *
 * THE ONE RULE, and the whole reason this is not a plain overwrite: the UI only ever SAW the
 * redacted view (`redactAuth`), so a literal secret reaches it as the mask `••••••`, never the
 * real value. If the user changes the auth type or types a new secret, that is a deliberate edit
 * and wins. But a field the user left untouched still reads `••••••` on save — and writing that
 * verbatim would replace a real token with six bullets. So a secret field still equal to the mask
 * means "keep what is stored", and only a genuinely-changed field overwrites.
 *
 * A `${secret:KEY}` reference is NOT masked (it is a pointer, not the secret), so it round-trips
 * as itself and needs no special case — it simply is not equal to the mask.
 *
 * This does not widen what a hostile page can do: the browser can only SET a new auth or keep the
 * one it could not read, never exfiltrate the stored secret. The residual that a caller who edits
 * a request's URL and hits Send spends its credential elsewhere is pre-existing and unchanged —
 * see the note on `updateRequestSchema` in routes.ts.
 */

import { REDACTED } from './store'
import type { RequestAuth } from './request-spec'

const keep = (incoming: string, stored: string | undefined): string =>
  incoming === REDACTED && stored !== undefined ? stored : incoming

export function mergeAuth(stored: RequestAuth, incoming: RequestAuth): RequestAuth {
  switch (incoming.type) {
    case 'basic':
      return {
        ...incoming,
        password: keep(incoming.password, stored.type === 'basic' ? stored.password : undefined),
      }
    case 'bearer':
      return {
        ...incoming,
        token: keep(incoming.token, stored.type === 'bearer' ? stored.token : undefined),
      }
    case 'apikey':
      return {
        ...incoming,
        value: keep(incoming.value, stored.type === 'apikey' ? stored.value : undefined),
      }
    case 'none':
      return incoming
  }
}
