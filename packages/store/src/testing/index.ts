import type { Listing, ListingDetail, PackageKind } from '../contract'

/**
 * A listing as a provider would hand it over, with every required field filled: a verified
 * package from a built-in source, nothing installed.
 */
export function makeListing(
  overrides: Partial<Listing> & { id: string; kind?: PackageKind },
): Listing {
  const { id, kind = 'mini-app', ...rest } = overrides
  return {
    ref: { kind, id },
    name: id,
    displayName: id,
    summary: `${id} does things`,
    tags: [],
    publisher: { name: 'Localix', verified: true },
    source: { id: 'https://hosted.test/catalog.json', label: 'Localix' },
    contents: {},
    runsCode: false,
    featured: false,
    recommended: false,
    installs: [],
    ...rest,
  }
}

/** A listing's detail page around `listing`: a README, two pictures and a fact. */
export function makeListingDetail(
  listing: Listing,
  overrides: Partial<ListingDetail> = {},
): ListingDetail {
  return {
    ...listing,
    readme: `# ${listing.displayName}\n\nPlay a **real** game.\n\n<b>raw</b>`,
    media: [
      { url: `/media/${listing.ref.id}/screenshot/0`, caption: 'The board' },
      { url: `/media/${listing.ref.id}/screenshot/1`, caption: 'A finished game' },
    ],
    facts: [{ label: 'License', value: 'MIT' }],
    components: [],
    ...overrides,
  }
}
