import type { Listing } from '@localixai/store'

/**
 * How an installed package takes its updates (`docs/extending/mini-app-publishing.md`, "Signing"):
 * from a signed marketplace on its own unless the person unticked Update automatically in its menu;
 * from an unsigned one only when the person chooses Update; from a marketplace whose signature
 * changed, not at all.
 */
export function PackageUpdates({ listing }: { listing: Listing }) {
  const said =
    listing.signature === 'mismatch'
      ? 'Its marketplace’s signature changed, so nothing is installed or updated from it. If the keeper moved to a new key, remove the marketplace in Sources and add it again.'
      : listing.installs.length === 0
        ? null
        : listing.autoUpdate === true
          ? 'Its marketplace is signed: newer versions install on their own. Untick Update automatically in its menu to stop that.'
          : listing.autoUpdate === false
            ? 'Automatic updates are off: it updates when you choose Update.'
            : listing.signature === 'unsigned'
              ? 'Its marketplace is not signed, so it updates only when you choose Update.'
              : null
  return said ? <p className="max-w-md text-sm text-text-soft">{said}</p> : null
}
