import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContextResolver } from '@localixai/mini-app-sdk/backend'

import { readerChapterUri } from '../shared/resource-uri'
import { createReaderContextProvider } from './context-provider'
import { createReaderResourceProvider } from './resource-provider'
import { ReaderService } from './service'

describe('Reader agent context', () => {
  test('captures the visible chapter through its canonical link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'localix-reader-context-'))
    const path = join(root, 'guide.md')
    await writeFile(path, '# Guide\n\nThe agent can see this exact passage.')
    const resourceProvider = createReaderResourceProvider(new ReaderService())
    const resolver = createReaderContextProvider(resourceProvider).provider as ContextResolver
    const uri = readerChapterUri({ path }, 0)
    const reference = {
      version: 1 as const,
      id: 'visible-reader-page',
      kind: 'resource',
      uri,
      freshness: 'resolve-at-send' as const,
      presentation: { token: `@resource:${uri}`, label: 'Guide · Guide' },
      scope: { userId: 'user', sessionId: 'session' },
    }

    expect(resolver.supports(reference, 'chat')).toBe(true)
    const result = await resolver.resolve(
      reference,
      { destination: 'chat', userId: 'user', sessionId: 'session', maxBytes: 64_000 },
      new AbortController().signal,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      providerId: 'reader:context',
      uri,
      sensitivity: 'project',
    })
    expect(result[0]?.content).toContain('The agent can see this exact passage.')
  })
})
