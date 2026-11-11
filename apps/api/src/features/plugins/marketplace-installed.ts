import type { CapabilitySourceRecord } from '../capabilities/source-repository'
import { parseMarketplaceRef, sourceMatchesRef } from './marketplace-source'
import type { KnownMarketplace } from './kit'

/**
 * The installed plugins a marketplace owns: rows recorded as `<plugin>@<marketplace>`, where the
 * marketplace part is its name or the source it was added from. Claude Code updates these with
 * the marketplace and uninstalls them when the marketplace is removed.
 */
export function installedFromMarketplace(
  rows: readonly CapabilitySourceRecord[],
  name: string,
  known?: KnownMarketplace,
): CapabilitySourceRecord[] {
  return rows.filter((row) => {
    const ref = parseMarketplaceRef(row.source)
    if (!ref) return false
    return (
      ref.marketplace === name || (known ? sourceMatchesRef(known.source, ref.marketplace) : false)
    )
  })
}
