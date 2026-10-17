import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { HOME_STRUCTURED_DATA } from './structuredData'

test('index.html ships the same structured data the docs restore on the way home', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/u.exec(html)?.[1]
  expect(JSON.parse(json ?? '{}')).toEqual(HOME_STRUCTURED_DATA)
})

test('the demo video entry points at published files', () => {
  const video = HOME_STRUCTURED_DATA['@graph'].find((node) => node['@type'] === 'VideoObject')
  for (const url of [video?.contentUrl, video?.thumbnailUrl]) {
    const file = new URL(`../../public${new URL(url ?? '').pathname}`, import.meta.url)
    expect(readFileSync(file).byteLength).toBeGreaterThan(0)
  }
})
