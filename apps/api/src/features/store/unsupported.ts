import type { PackageKind } from '@localixai/store'

import { ConflictError } from '../../lib/domain-errors'

/** What a kind's provider does not do: the one refusal every Store route answers with. */
export const unsupported = (kind: PackageKind, what: string) =>
  new ConflictError('store_unsupported', `${kind} packages cannot ${what}`)
