import { test, expect } from 'bun:test'
import { mkdtemp, open, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MessageAttachment } from '@localixai/agent'

import {
  ATTACHMENT_SPILL_CONCURRENCY,
  spillMessageAttachments,
  attachmentsDirRel,
  MAX_INLINE_LINES,
  SPILL_PREVIEW_LINES,
  TEXT_PREVIEW_BYTES,
  MAX_PATH_IMAGE_BYTES,
} from './attachment-spill'
import { createReadTool } from '../../../agent-core/tools/file/read'
import { createMediaStore } from '../../../media/store'

async function cwd() {
  return mkdtemp(path.join(tmpdir(), 'spill-test-'))
}

const textAtt = (name: string, text: string): MessageAttachment => ({
  kind: 'text',
  name,
  text,
  size: Buffer.byteLength(text, 'utf8'),
})

test('a path attachment uses its original absolute path and writes no spill copy', async () => {
  const dir = await cwd()
  const originalPath = path.join(dir, 'original.txt')
  const text = Array.from({ length: SPILL_PREVIEW_LINES + 10 }, (_, i) => `row ${i}`).join('\n')
  await writeFile(originalPath, text)
  const original: MessageAttachment = {
    kind: 'path',
    path: originalPath,
    name: 'original.txt',
    mediaType: 'text/plain',
    size: Buffer.byteLength(text),
  }
  const attachments = [original]

  const out = await spillMessageAttachments(attachments, {
    defaultCwd: dir,
    sessionId: 's',
    messageId: 'm',
  })

  expect(attachments[0]).toBe(original)
  expect(attachments[0]).toEqual({
    kind: 'path',
    path: originalPath,
    name: 'original.txt',
    mediaType: 'text/plain',
    size: Buffer.byteLength(text),
  })
  expect(out[0]).toMatchObject({
    kind: 'text',
    spilled: true,
    path: originalPath,
    lineCount: SPILL_PREVIEW_LINES + 10,
  })
  if (out[0]?.kind !== 'text') throw new Error('expected text manifest')
  expect(out[0].text).toContain(originalPath)
  expect(out[0].text).toContain('row 0')
  expect(out[0].text).not.toContain(`row ${SPILL_PREVIEW_LINES}`)
  expect(readdir(path.join(dir, '.localix', 'attachments'))).rejects.toThrow()
})

test('a missing path attachment becomes a stated unavailable-file message', async () => {
  const dir = await cwd()
  const missingPath = path.join(dir, 'moved.txt')

  const [out] = await spillMessageAttachments(
    [
      {
        kind: 'path',
        path: missingPath,
        name: 'moved.txt',
        mediaType: 'text/plain',
        size: 100,
      },
    ],
    { defaultCwd: dir, sessionId: 's', messageId: 'm' },
  )

  expect(out.kind).toBe('text')
  if (out.kind !== 'text') throw new Error('expected text manifest')
  expect(out.path).toBe(missingPath)
  expect(out.text).toContain('no longer available at its original path')
  expect(out.text).toContain('moved, renamed, or deleted')
})

test('an outside-workspace path is not previewed before the agent asks permission', async () => {
  const workspace = await cwd()
  const outside = await cwd()
  const originalPath = path.join(outside, 'private.txt')
  await writeFile(originalPath, 'secret preview must not cross the permission boundary')

  const [out] = await spillMessageAttachments(
    [
      {
        kind: 'path',
        path: originalPath,
        name: 'private.txt',
        mediaType: 'text/plain',
        size: 53,
      },
    ],
    { defaultCwd: workspace, sessionId: 's', messageId: 'm' },
  )

  expect(out.kind).toBe('text')
  if (out.kind !== 'text') throw new Error('expected text manifest')
  expect(out.path).toBe(originalPath)
  expect(out.text).toContain('outside the workspace')
  expect(out.text).toContain('user will be asked for permission')
  expect(out.text).not.toContain('secret preview')
  expect(readdir(path.join(workspace, '.localix', 'attachments'))).rejects.toThrow()
})

test('small text attachment stays inlined (same reference, no disk write)', async () => {
  const dir = await cwd()
  const atts = [textAtt('notes.md', 'line1\nline2\n')]
  const out = await spillMessageAttachments(atts, {
    defaultCwd: dir,
    sessionId: 's1',
    messageId: 'm1',
  })
  expect(out).toBe(atts) // unchanged reference
  expect((out[0] as { spilled?: boolean }).spilled).toBeUndefined()
})

test('large text spills to a manifest + a file the read tool can open', async () => {
  const dir = await cwd()
  const big = Array.from({ length: MAX_INLINE_LINES + 500 }, (_, i) => `row ${i}`).join('\n')
  const out = await spillMessageAttachments([textAtt('data.csv', big)], {
    defaultCwd: dir,
    sessionId: 'sess-1',
    messageId: 'msg-1',
  })
  const att = out[0]
  expect(att.kind).toBe('text')
  if (att.kind !== 'text') throw new Error('expected text')
  expect(att.spilled).toBe(true)
  expect(att.lineCount).toBe(MAX_INLINE_LINES + 500)
  const relPath = path.posix.join(attachmentsDirRel('sess-1', 'msg-1'), 'data.csv')
  expect(att.path).toBe(relPath)
  // Manifest carries the path + a bounded preview, NOT the full file.
  expect(att.text).toContain(relPath)
  expect(att.text).toContain(`first ${SPILL_PREVIEW_LINES} of 2500 lines`)
  expect(att.text).toContain('row 0')
  expect(att.text).not.toContain(`row ${MAX_INLINE_LINES + 100}`)
  expect(att.text.length).toBeLessThan(big.length) // genuinely smaller footprint

  // The real file exists on disk with the full content...
  const onDisk = await readFile(path.resolve(dir, relPath), 'utf8')
  expect(onDisk).toBe(big)

  // ...and the agent's read tool opens it via the cwd-relative manifest path.
  const read = createReadTool(undefined, dir)
  const res = await read.execute(
    't',
    { path: relPath, start_line: MAX_INLINE_LINES + 1, end_line: MAX_INLINE_LINES + 3 },
    undefined,
  )
  expect(res.isError).toBeFalsy()
  expect(res.content).toContain(`row ${MAX_INLINE_LINES}`)
})

test('non-image binary file spills to a manifest line + bytes on disk', async () => {
  const dir = await cwd()
  const bytes = Buffer.from('PK zip-ish payload')
  const fileAtt: MessageAttachment = {
    kind: 'file',
    name: 'archive.zip',
    mediaType: 'application/zip',
    data: bytes.toString('base64'),
    size: bytes.length,
  }
  const out = await spillMessageAttachments([fileAtt], {
    defaultCwd: dir,
    sessionId: 's',
    messageId: 'm',
  })
  const att = out[0]
  expect(att.kind).toBe('text')
  if (att.kind !== 'text') throw new Error('expected text')
  expect(att.spilled).toBe(true)
  expect(att.text).toContain('application/zip')
  expect(att.text).toContain('Binary file')
  const onDisk = await readFile(path.resolve(dir, att.path!))
  expect(Buffer.compare(onDisk, bytes)).toBe(0)
})

test('a mediaId spill copies byte-identical output without base64 rehydration', async () => {
  const dir = await cwd()
  const bytes = Buffer.allocUnsafe(256 * 1024)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
  const store = createMediaStore({ dir: path.join(dir, 'media') })
  const stored = await store.putBytes(bytes, 'application/zip', { nameHint: 'archive.zip' })
  const common = {
    kind: 'file' as const,
    name: 'archive.zip',
    mediaType: 'application/zip',
    size: bytes.length,
  }

  const inline = await spillMessageAttachments([{ ...common, data: bytes.toString('base64') }], {
    defaultCwd: path.join(dir, 'inline'),
    sessionId: 's',
    messageId: 'm',
  })
  const direct = await spillMessageAttachments([{ ...common, mediaId: stored.id }], {
    defaultCwd: path.join(dir, 'direct'),
    sessionId: 's',
    messageId: 'm',
    mediaStore: store,
  })
  const inlineAttachment = inline[0]
  const directAttachment = direct[0]
  expect(inlineAttachment.kind).toBe('text')
  expect(directAttachment.kind).toBe('text')
  if (inlineAttachment.kind !== 'text' || directAttachment.kind !== 'text') {
    throw new Error('expected spilled text manifests')
  }

  const inlineBytes = await readFile(path.resolve(path.join(dir, 'inline'), inlineAttachment.path!))
  const directBytes = await readFile(path.resolve(path.join(dir, 'direct'), directAttachment.path!))
  expect(directBytes).toEqual(inlineBytes)
  expect(directBytes).toEqual(bytes)
  expect(directAttachment.text).toBe(inlineAttachment.text)

  const repeated = await spillMessageAttachments(direct, {
    defaultCwd: path.join(dir, 'direct'),
    sessionId: 's',
    messageId: 'm',
    mediaStore: store,
  })
  expect(repeated).toBe(direct)
})

test('a missing mediaId spill passes through unchanged', async () => {
  const dir = await cwd()
  const store = createMediaStore({ dir: path.join(dir, 'media') })
  const attachments: MessageAttachment[] = [
    {
      kind: 'file',
      name: 'gone.zip',
      mediaType: 'application/zip',
      mediaId: `${'0'.repeat(64)}.zip`,
      size: 10,
    },
  ]

  const output = await spillMessageAttachments(attachments, {
    defaultCwd: dir,
    sessionId: 's',
    messageId: 'm',
    mediaStore: store,
  })
  expect(output).toBe(attachments)
})

test('images keep their native wire path (never spilled)', async () => {
  // Images are the ONLY binary the wire still carries natively: a user message's content is
  // `string | (TextContent | ImageContent)[]`, so vision works end to end.
  const dir = await cwd()
  const img: MessageAttachment = {
    kind: 'image',
    name: 'a.png',
    mediaType: 'image/png',
    data: 'AAAA',
    size: 3,
  }
  const atts = [img]
  const out = await spillMessageAttachments(atts, {
    defaultCwd: dir,
    sessionId: 's',
    messageId: 'm',
  })
  expect(out).toBe(atts)
})

test('a PDF is spilled to disk, not handed to the codec as a filename stub', async () => {
  // INTENTIONAL BEHAVIOUR CHANGE. This test previously asserted PDFs were never spilled,
  // on the premise that they reached the model as a native document block. Measured, that
  // premise was false on the earlier runtime: `toModelMessages` produced the right `FileContent`
  // part and its codec then replaced it with the literal text `[Attached file: doc.pdf]`,
  // so every byte was lost silently. Spilling gives the agent a real path (and, with the
  // documents capability wired, extracted text) instead of a filename.
  const dir = await cwd()
  const pdf: MessageAttachment = {
    kind: 'file',
    name: 'doc.pdf',
    mediaType: 'application/pdf',
    data: Buffer.from('%PDF-1.4\ntrailer\n').toString('base64'),
    size: 17,
  }
  const out = await spillMessageAttachments([pdf], {
    defaultCwd: dir,
    sessionId: 's',
    messageId: 'm',
  })
  const spilled = out[0] as { kind: string; spilled?: boolean; path?: string; text?: string }
  expect(spilled.kind).toBe('text')
  expect(spilled.spilled).toBe(true)
  expect(spilled.path).toContain('doc.pdf')
  // The manifest must name the on-disk path so the agent can re-read it.
  expect(spilled.text).toContain(spilled.path!)
  // And the bytes really are on disk, not just described.
  const onDisk = await readFile(path.resolve(dir, spilled.path!))
  expect(onDisk.toString('utf8')).toContain('%PDF-1.4')
})

test('a PDF reaches the document extractor, so the manifest carries its TEXT', async () => {
  // Pins the WIRING my change created, not the extraction itself (that is the documents
  // plugin's own tested concern): a PDF must now be offered to `extractDocument`, and its
  // returned text must land in the manifest instead of an opaque binary line.
  const dir = await cwd()
  const seen: string[] = []
  const out = await spillMessageAttachments(
    [
      {
        kind: 'file',
        name: 'spec.pdf',
        mediaType: 'application/pdf',
        data: Buffer.from('%PDF-1.4\n').toString('base64'),
        size: 9,
      },
    ],
    {
      defaultCwd: dir,
      sessionId: 's',
      messageId: 'm',
      extractDocument: async (target: string) => {
        seen.push(target)
        return 'Quarterly plan\nRevenue targets\n'
      },
    },
  )
  expect(seen).toHaveLength(1)
  expect(seen[0]).toContain('spec.pdf')
  const spilled = out[0] as { kind: string; text?: string; lineCount?: number }
  expect(spilled.kind).toBe('text')
  // A line count only exists on the EXTRACTED path — the binary fallback has none.
  expect(spilled.lineCount).toBeGreaterThan(0)
})

test('filename collisions within a message get numeric suffixes', async () => {
  const dir = await cwd()
  const big = 'x\n'.repeat(MAX_INLINE_LINES + 10)
  const out = await spillMessageAttachments([textAtt('log.txt', big), textAtt('log.txt', big)], {
    defaultCwd: dir,
    sessionId: 's',
    messageId: 'm',
  })
  const p0 = (out[0] as { path?: string }).path
  const p1 = (out[1] as { path?: string }).path
  expect(p0).toContain('log.txt')
  expect(p1).toContain('log-1.txt')
  expect(p0).not.toBe(p1)
})

test('no cwd → cannot spill, attachment stays inlined', async () => {
  const big = 'y\n'.repeat(MAX_INLINE_LINES + 10)
  const atts = [textAtt('huge.txt', big)]
  const out = await spillMessageAttachments(atts, {
    defaultCwd: undefined,
    sessionId: 's',
    messageId: 'm',
  })
  expect(out).toBe(atts)
})

test('re-spilling an already-spilled attachment is idempotent', async () => {
  const dir = await cwd()
  const big = 'z\n'.repeat(MAX_INLINE_LINES + 10)
  const first = await spillMessageAttachments([textAtt('f.txt', big)], {
    defaultCwd: dir,
    sessionId: 's',
    messageId: 'm',
  })
  const second = await spillMessageAttachments(first, {
    defaultCwd: dir,
    sessionId: 's',
    messageId: 'm',
  })
  expect(second).toBe(first) // no further change
})

test('a byte-heavy but line-light attachment says its full text is shown', async () => {
  // "Showing the first 50 lines — read the rest" would send the model on a read that
  // returns nothing new: there is no rest.
  const wide = Array.from({ length: 10 }, (_, i) => `row ${i} ${'x'.repeat(8000)}`).join('\n')
  const dir = await cwd()
  const out = await spillMessageAttachments([textAtt('wide.txt', wide)], {
    defaultCwd: dir,
    sessionId: 'sess-1',
    messageId: 'msg-2',
  })
  const att = out[0] as { text: string }
  expect(att.text).toContain('Its full text is shown below')
  expect(att.text).not.toContain('to see the rest')
})

test('counts a huge line set while retaining only the bounded preview', async () => {
  const lineCount = 50_000
  const text = Array.from({ length: lineCount }, (_, index) => `line-${index}`).join('\n')
  const dir = await cwd()
  const [out] = await spillMessageAttachments([textAtt('huge.txt', text)], {
    defaultCwd: dir,
    sessionId: 's',
    messageId: 'many-lines',
  })

  expect(out.kind).toBe('text')
  if (out.kind !== 'text') return
  expect(out.lineCount).toBe(lineCount)
  expect(out.text).toContain('line-49')
  expect(out.text).not.toContain('line-50\n')
  expect(out.text.length).toBeLessThan(2_000)
})

test('exports a conservative spill concurrency budget', () => {
  expect(ATTACHMENT_SPILL_CONCURRENCY).toBeGreaterThan(0)
  expect(ATTACHMENT_SPILL_CONCURRENCY).toBeLessThanOrEqual(8)
})

/**
 * The categories that used to fall between the two mechanisms.
 *
 * Spilling excluded every `image/*` because "the wire carries ImageContent" — true only for
 * png/jpeg/gif/webp — and audio/video were excluded by kind. So a HEIC, an SVG, an mp3 or an
 * mp4 was neither spilled nor representable on the wire, and reached the model as the bare
 * text stub `[Attached file: x.heic]`. These three fail against that old predicate.
 */
const binaryAtt = (
  kind: 'image' | 'audio' | 'video' | 'file',
  name: string,
  mediaType: string,
): MessageAttachment =>
  ({
    kind,
    name,
    mediaType,
    data: Buffer.from('binary-bytes').toString('base64'),
    size: 12,
  }) as MessageAttachment

for (const [kind, name, mediaType] of [
  ['image', 'photo.heic', 'image/heic'],
  ['image', 'diagram.svg', 'image/svg+xml'],
  ['audio', 'memo.mp3', 'audio/mpeg'],
  ['video', 'clip.mp4', 'video/mp4'],
] as const) {
  test(`${mediaType} is handed to the model as a file on disk, not a filename stub`, async () => {
    const dir = await cwd()
    const out = await spillMessageAttachments([binaryAtt(kind, name, mediaType)], {
      defaultCwd: dir,
      sessionId: 's1',
      messageId: 'm1',
    })
    const spilled = out[0] as { kind: string; spilled?: boolean; path?: string; text?: string }
    expect(spilled.kind).toBe('text')
    expect(spilled.spilled).toBe(true)
    expect(spilled.path).toContain(attachmentsDirRel('s1', 'm1'))
    // The manifest must name the real path, so the agent can act on it.
    expect(spilled.text).toContain(spilled.path!)
    // And the bytes are actually there.
    expect(await readFile(path.resolve(dir, spilled.path!))).toEqual(Buffer.from('binary-bytes'))
  })
}

test('a png still rides the wire as bytes — spilling it would cost native vision', async () => {
  const dir = await cwd()
  const atts = [binaryAtt('image', 'shot.png', 'image/png')]
  const out = await spillMessageAttachments(atts, {
    defaultCwd: dir,
    sessionId: 's1',
    messageId: 'm1',
  })
  expect(out).toBe(atts) // untouched reference: no disk write, no manifest
})

test('a large TEXT file stored by media id still gets the text manifest, not a binary one', async () => {
  // The composer routes everything at or above 50KB through the media store, so a big .log or
  // .csv arrives as `kind: 'file'` rather than `kind: 'text'`. It used to fall through to the
  // binary manifest — path, type, size, nothing to read — and the model had to spend a `read`
  // just to learn what the file was. `extractDocument` cannot cover it: office/PDF only.
  const dir = await cwd()
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n')
  const out = await spillMessageAttachments(
    [
      {
        kind: 'file',
        name: 'server.log',
        mediaType: 'text/plain',
        data: Buffer.from(lines).toString('base64'),
        size: lines.length,
      } as MessageAttachment,
    ],
    { defaultCwd: dir, sessionId: 's1', messageId: 'm1' },
  )
  const spilled = out[0] as { kind: string; text?: string; lineCount?: number }
  expect(spilled.kind).toBe('text')
  expect(spilled.lineCount).toBe(400)
  // The head preview is the point: the model can see what this is without reading first.
  expect(spilled.text).toContain('line 0')
})

test('a real binary stored the same way still gets the binary manifest', async () => {
  const dir = await cwd()
  const out = await spillMessageAttachments(
    [
      {
        kind: 'file',
        name: 'blob.bin',
        mediaType: 'application/octet-stream',
        data: Buffer.from([0, 1, 2, 3, 0xff]).toString('base64'),
        size: 5,
      } as MessageAttachment,
    ],
    { defaultCwd: dir, sessionId: 's1', messageId: 'm1' },
  )
  const spilled = out[0] as { kind: string; text?: string; lineCount?: number }
  expect(spilled.kind).toBe('text')
  expect(spilled.lineCount).toBeUndefined()
  expect(spilled.text).toContain('application/octet-stream')
})

/**
 * A `path` attachment names a file nobody sized: the composer deliberately stopped checking,
 * because the agent decides what to do with the path. That makes the manifest builder the last
 * place holding an unbounded read — it used to `readFile` the WHOLE file to produce a 50-line
 * preview, so attaching a big log pulled it entirely into the API process.
 *
 * The fixture is SPARSE: `truncate` to 1 GiB costs no disk and no time, but a whole-file read
 * must still materialize a gigabyte. Measured against the pre-fix code, that read SUCCEEDS —
 * in 746ms, holding a 1 GiB buffer plus a 1 GiB string at once, on the single Bun thread every
 * session shares. So the failure it guards is resource exhaustion under concurrent attachments,
 * not an exception; the timing bound below is set well under that measured 746ms, and the
 * manifest assertions fail on the pre-fix code independently of timing.
 */
test('a text path attachment larger than the preview bound is previewed, not slurped', async () => {
  const dir = await cwd()
  const hugePath = path.join(dir, 'huge.log')
  const head = Array.from({ length: SPILL_PREVIEW_LINES + 10 }, (_, i) => `row ${i}`).join('\n')
  await writeFile(hugePath, head)
  const handle = await open(hugePath, 'r+')
  try {
    await handle.truncate(1024 * 1024 * 1024)
  } finally {
    await handle.close()
  }

  const started = performance.now()
  const [out] = await spillMessageAttachments(
    [{ kind: 'path', path: hugePath, name: 'huge.log', mediaType: 'text/plain', size: 0 }],
    { defaultCwd: dir, sessionId: 's', messageId: 'm' },
  )
  const elapsedMs = performance.now() - started

  if (out.kind !== 'text') throw new Error('expected text manifest')
  // The head is readable …
  expect(out.text).toContain('row 0')
  // … the size is reported from stat, not from what was read …
  expect(out.text).toContain('1024.0MB')
  // … the manifest does not claim a line count it cannot know from a prefix …
  expect(out.lineCount).toBeUndefined()
  expect(out.text).not.toMatch(/\d+ lines\)/)
  expect(out.text).toContain('too large to preview whole')
  expect(out.text).toContain(`its first ${SPILL_PREVIEW_LINES} lines`)
  // … and the file was never read past the bound.
  expect(elapsedMs).toBeLessThan(250)
})

test('a truncated prefix ending mid-character is still treated as text', async () => {
  // The cut lands at an arbitrary byte, so it can split a multi-byte sequence. Were the partial
  // tail decoded to U+FFFD, every large file containing non-ASCII text would be misreported as
  // binary and lose its preview entirely.
  const dir = await cwd()
  const filePath = path.join(dir, 'multibyte.log')
  const line = `${'→'.repeat(64)}\n`
  const body = line.repeat(Math.ceil((TEXT_PREVIEW_BYTES * 1.5) / Buffer.byteLength(line, 'utf8')))
  await writeFile(filePath, body)

  const [out] = await spillMessageAttachments(
    [
      {
        kind: 'path',
        path: filePath,
        name: 'multibyte.log',
        mediaType: 'text/plain',
        size: Buffer.byteLength(body, 'utf8'),
      },
    ],
    { defaultCwd: dir, sessionId: 's', messageId: 'm' },
  )

  if (out.kind !== 'text') throw new Error('expected text manifest')
  expect(out.text).toContain('→')
  expect(out.text).not.toContain('Binary file')
})

// A screenshot lives on the Desktop, and the session's workspace is a project dir,
// so this path is ALWAYS outside the cwd. It used to come back as the
// permission-required text manifest — the model was handed a sentence about the
// `read` tool instead of the picture the user had just dragged in.
test('an image attached by path is carried natively even from outside the workspace', async () => {
  const dir = await cwd()
  const elsewhere = await cwd()
  const shot = path.join(elsewhere, 'Screenshot 2026-08-30 at 1.33.28 AM.png')
  const bytes = Buffer.from('89504e470d0a1a0a-not-a-real-png-but-real-bytes', 'utf8')
  await writeFile(shot, bytes)

  const [out] = await spillMessageAttachments(
    [
      {
        kind: 'path',
        path: shot,
        name: 'Screenshot 2026-08-30 at 1.33.28 AM.png',
        mediaType: 'image/png',
        size: bytes.byteLength,
      },
    ],
    { defaultCwd: dir, sessionId: 's', messageId: 'm' },
  )

  expect(out).toMatchObject({
    kind: 'image',
    mediaType: 'image/png',
    size: bytes.byteLength,
  })
  if (out?.kind !== 'image') throw new Error('expected a native image part')
  expect(Buffer.from(out.data ?? '', 'base64').equals(bytes)).toBe(true)
  // Copy-free: carrying the bytes must not also spill a duplicate into the workspace.
  await expect(readdir(path.join(dir, '.localix', 'attachments'))).rejects.toThrow()
})

test('an oversized path image keeps the manifest instead of inlining itself', async () => {
  const dir = await cwd()
  const elsewhere = await cwd()
  const huge = path.join(elsewhere, 'huge.png')
  await writeFile(huge, Buffer.alloc(MAX_PATH_IMAGE_BYTES + 1, 7))

  const [out] = await spillMessageAttachments(
    [
      {
        kind: 'path',
        path: huge,
        name: 'huge.png',
        mediaType: 'image/png',
        size: MAX_PATH_IMAGE_BYTES + 1,
      },
    ],
    { defaultCwd: dir, sessionId: 's', messageId: 'm' },
  )

  expect(out?.kind).toBe('text')
  if (out?.kind !== 'text') throw new Error('expected a manifest')
  expect(out.text).toContain(huge)
})

// The macOS screenshot thumbnail can be dragged before its file is written, so the
// pasteboard path may name bytes that are not there. Saying so beats a manifest
// that tells the agent to go and read them.
test('a missing path image states that it is unavailable', async () => {
  const dir = await cwd()
  const elsewhere = await cwd()
  const gone = path.join(elsewhere, 'never-written.png')

  const [out] = await spillMessageAttachments(
    [{ kind: 'path', path: gone, name: 'never-written.png', mediaType: 'image/png', size: 10 }],
    { defaultCwd: dir, sessionId: 's', messageId: 'm' },
  )

  expect(out?.kind).toBe('text')
  if (out?.kind !== 'text') throw new Error('expected a manifest')
  expect(out.text).toContain('no longer available')
  expect(out.text).not.toContain('read` tool')
})
