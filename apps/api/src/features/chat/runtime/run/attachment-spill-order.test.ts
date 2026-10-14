import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MessageAttachment } from '@localixai/agent'
import { createMediaStore } from '../../../media/store'
import { spillMessageAttachments } from './attachment-spill'

test('duplicate spill names follow authored order even when media resolves in reverse order', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'spill-order-'))
  try {
    const store = createMediaStore({ dir: path.join(dir, 'media') })
    const firstBytes = Buffer.from('first authored attachment')
    const secondBytes = Buffer.from('second authored attachment')
    const first = await store.putBytes(firstBytes, 'application/zip')
    const second = await store.putBytes(secondBytes, 'application/zip')
    const resolved: string[] = []
    let releaseFirst = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const delayedStore = {
      ...store,
      async resolve(id: string) {
        if (id === first.id) await firstGate
        const value = await store.resolve(id)
        resolved.push(id)
        if (id === second.id) releaseFirst()
        return value
      },
    }
    const attachments: MessageAttachment[] = [first, second].map((stored) => ({
      kind: 'file',
      name: 'archive.zip',
      mediaType: 'application/zip',
      size: stored.size,
      mediaId: stored.id,
    }))
    const result = await spillMessageAttachments(attachments, {
      defaultCwd: dir,
      sessionId: 'session',
      messageId: 'message',
      mediaStore: delayedStore,
    })
    expect(resolved).toEqual([second.id, first.id])
    const paths = result.map((attachment) => {
      if (attachment.kind !== 'text' || !attachment.path) throw new Error('Expected file handoff')
      return attachment.path
    })
    expect(paths.map((file) => path.basename(file))).toEqual(['archive.zip', 'archive-1.zip'])
    expect(await readFile(path.resolve(dir, paths[0]))).toEqual(firstBytes)
    expect(await readFile(path.resolve(dir, paths[1]))).toEqual(secondBytes)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 5_000)
