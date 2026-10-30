import { describe, expect, test } from 'bun:test'

import { LOCALIX_COMMUNITY, LOCALIX_MARKETPLACE } from '@localixai/store'

import { builtInMiniAppSources } from './store-sources'

const release = (repo: string) =>
  `https://github.com/${repo}/releases/latest/download/mini-app-marketplace.json`

const COMMUNITY = {
  url: release('rsaryev/localix-community'),
  name: 'localix-community',
  vouches: false,
  builtIn: true,
  pinned: LOCALIX_COMMUNITY.signingKeys,
  id: 'localix-community-mini-apps',
}

describe('the marketplaces every installation reads', () => {
  test("the Localix marketplace's release, which Localix vouches for, then Localix Community's", () => {
    expect(builtInMiniAppSources({})).toEqual([
      {
        url: release('rsaryev/localix-marketplace'),
        name: 'localix',
        vouches: true,
        builtIn: true,
        pinned: LOCALIX_MARKETPLACE.signingKeys,
        id: 'localix-mini-apps',
      },
      COMMUNITY,
    ])
  })

  // Their apps update on their own only while a signature holds for a key Localix ships with.
  test('each is checked against Ed25519 keys Localix ships with', () => {
    for (const source of builtInMiniAppSources({}))
      for (const key of source.pinned ?? []) expect(Buffer.from(key, 'base64')).toHaveLength(32)
  })

  // A local build is unsigned, or signed with its builder's key: the release's keys would only
  // make it read as a signature changed, and nothing from it would install.
  test('a marketplace build not yet released stands in for it, with the key it was signed with', () => {
    const local = 'file:///work/localix-marketplace/dist/marketplace/mini-app-marketplace.json'
    expect(builtInMiniAppSources({ LOCALIX_MINI_APP_MARKETPLACE_URL: local })[0]).toEqual({
      url: local,
      name: 'localix',
      vouches: true,
      builtIn: true,
      id: 'localix-mini-apps',
    })
    expect(
      builtInMiniAppSources({
        LOCALIX_MINI_APP_MARKETPLACE_URL: local,
        LOCALIX_MINI_APP_MARKETPLACE_KEY: 'LOCAL',
      })[0]?.pinned,
    ).toEqual(['LOCAL'])
  })

  test('so does a community list not yet released', () => {
    const local = 'file:///work/localix-community/dist/mini-app-marketplace.json'
    expect(
      builtInMiniAppSources({
        LOCALIX_COMMUNITY_MARKETPLACE_URL: local,
        LOCALIX_COMMUNITY_MARKETPLACE_KEY: 'LOCAL',
      })[1],
    ).toEqual({ ...COMMUNITY, url: local, pinned: ['LOCAL'] })
  })
})
