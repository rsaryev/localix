import { afterEach, describe, expect, test } from 'bun:test'

import { previewHostKey, usePreviewHosts } from './previewHosts'

afterEach(() => usePreviewHosts.setState({ live: {}, foreground: {} }))

describe('off-screen preview hosts', () => {
  test('a run ending releases its workspace’s hidden hosts, never the visible one or another’s', () => {
    const hosts = usePreviewHosts.getState()
    hosts.opened(previewHostKey('s1', 'hidden'))
    hosts.opened(previewHostKey('s1', 'shown'))
    hosts.opened(previewHostKey('s2', 'other'))
    const detach = hosts.attach(previewHostKey('s1', 'shown'))

    expect(usePreviewHosts.getState().releaseWorkspace('s1')).toEqual(['hidden'])
    expect(Object.keys(usePreviewHosts.getState().live).sort()).toEqual(
      [previewHostKey('s1', 'shown'), previewHostKey('s2', 'other')].sort(),
    )
    detach()
  })
})
