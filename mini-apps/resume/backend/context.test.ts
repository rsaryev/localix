import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createResumeService } from './service'
import { createResumeContextProvider, createResumeResourceProvider } from './context'
import { createTemplateDocument } from '../shared/templates'
import { resumeUri } from '../shared/resource-uri'

test('resource links resolve only in the owning session workspace and capture focused section evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resume-context-'))
  const other = await mkdtemp(join(tmpdir(), 'resume-other-'))
  try {
    const service = createResumeService(root)
    const doc = createTemplateDocument('awal', 'CV')
    doc.sections[0]!.entries[0]!.body = 'Verified professional summary'
    const resume = await service.create('user', doc)
    const resource = createResumeResourceProvider(async (user, session) =>
      user !== 'user'
        ? null
        : session === 'first'
          ? service
          : session === 'second'
            ? createResumeService(other)
            : null,
    )
    const uri = resumeUri(resume.id, doc.sections[0]!.id)
    expect(await resource.expand('user', uri)).toEqual({ ok: false })
    expect(await resource.expand('user', uri, { sessionId: 'second' })).toEqual({ ok: false })
    const expanded = await resource.expand('user', uri, { sessionId: 'first' })
    expect(expanded.ok).toBe(true)
    expect(expanded.content).toContain('Verified professional summary')
    const { provider } = createResumeContextProvider(resource)
    if (!('resolve' in provider)) throw new Error('Resume context must resolve explicit references')
    const contribution = await provider.resolve(
      {
        version: 1,
        presentation: { label: 'CV summary' },
        freshness: 'resolve-at-send',
        id: 'binding',
        kind: 'resource',
        uri,
        scope: { userId: 'user', sessionId: 'first' },
      },
      { destination: 'chat', userId: 'user', sessionId: 'first', maxBytes: 64_000 },
      new AbortController().signal,
    )
    expect(contribution[0]?.content).toContain(`Revision: ${resume.revision}`)
    expect(contribution[0]?.uri).toBe(uri)
  } finally {
    await Promise.all([root, other].map((dir) => rm(dir, { recursive: true, force: true })))
  }
})
