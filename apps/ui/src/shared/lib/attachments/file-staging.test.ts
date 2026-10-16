import { afterEach, describe, expect, test } from 'bun:test'

import { acceptAttribute, attachmentGate } from '@/shared/lib/attachment-policy'
import {
  filesFromDesktopPick,
  filesToAttachments,
  messageAttachmentToFile,
  rememberDroppedFilePath,
} from '@/shared/lib/attachments/file-staging'

describe('attachmentGate', () => {
  test('unknown / empty modalities are permissive (matches backend default)', () => {
    expect(attachmentGate(undefined)).toEqual({
      allowImages: true,
      allowPdf: true,
      allowAudio: true,
      allowDocuments: true,
      limitPickerToAllowedKinds: false,
    })
    expect(attachmentGate([])).toEqual({
      allowImages: true,
      allowPdf: true,
      allowAudio: true,
      allowDocuments: true,
      limitPickerToAllowedKinds: false,
    })
  })

  test('known modalities select native parts without refusing agent-readable resources', () => {
    expect(attachmentGate(['image'])).toEqual({
      allowImages: true,
      allowPdf: false,
      allowAudio: false,
      allowDocuments: true,
      limitPickerToAllowedKinds: false,
    })
    expect(attachmentGate(['text'])).toEqual({
      allowImages: false,
      allowPdf: false,
      allowAudio: false,
      allowDocuments: true,
      limitPickerToAllowedKinds: false,
    })
    expect(attachmentGate(['image', 'pdf', 'audio'])).toEqual({
      allowImages: true,
      allowPdf: true,
      allowAudio: true,
      allowDocuments: true,
      limitPickerToAllowedKinds: false,
    })
  })
})

describe('messageAttachmentToFile', () => {
  test('decodes an image attachment back to its exact bytes (screenshot / composerBus path)', async () => {
    const bytes = new Uint8Array([0, 255, 16, 128, 7, 0, 200]) // includes a NUL + high bytes
    const data = btoa(String.fromCharCode(...bytes))
    const file = messageAttachmentToFile({
      kind: 'image',
      mediaType: 'image/jpeg',
      data,
      name: 'shot.jpg',
      size: bytes.length,
    })
    expect(file.name).toBe('shot.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
  })

  test('text attachment becomes a text/plain File', async () => {
    const file = messageAttachmentToFile({ kind: 'text', text: 'hello', name: 'note.txt', size: 5 })
    expect(file.type).toContain('text/plain')
    expect(await file.text()).toBe('hello')
  })

  test('a media-id attachment keeps its resource when re-staged', async () => {
    const file = messageAttachmentToFile({
      kind: 'image',
      mediaType: 'image/png',
      mediaId: 'stored.png',
      name: 'stored.png',
      size: 60_000,
    })

    const { pending, rejected } = await filesToAttachments([file], attachmentGate(['image']))

    expect(file.size).toBe(0)
    expect(rejected).toEqual([])
    expect(pending).toHaveLength(1)
    expect(pending[0]!.attachment).toMatchObject({
      kind: 'image',
      mediaId: 'stored.png',
      name: 'stored.png',
      size: 60_000,
    })
  })
})

describe('filesToAttachments — partial-failure batch (crumple zone)', () => {
  // Stub FileReader so one file in the batch errors and another reads cleanly, and
  // track object-URL churn to prove no preview URL is orphaned on the failure path.
  const realFileReader = globalThis.FileReader
  const realCreate = URL.createObjectURL.bind(URL)
  const realRevoke = URL.revokeObjectURL.bind(URL)
  afterEach(() => {
    globalThis.FileReader = realFileReader
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
  })

  test('one unreadable file does not discard the good files (or leak their URLs)', async () => {
    const created: string[] = []
    const revoked: string[] = []
    URL.createObjectURL = ((f: File) => {
      const url = `blob:mock/${(f as File).name}`
      created.push(url)
      return url
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = ((url: string) => void revoked.push(url)) as typeof URL.revokeObjectURL

    // Fake FileReader: 'bad.png' triggers onerror, everything else onload.
    globalThis.FileReader = class {
      result: string | null = null
      error: unknown = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(file: File) {
        queueMicrotask(() => {
          if (file.name === 'bad.png') {
            this.error = new Error('read failed')
            this.onerror?.()
          } else {
            this.result = `data:image/png;base64,${btoa('ok')}`
            this.onload?.()
          }
        })
      }
      readAsText(_file: File) {
        queueMicrotask(() => {
          this.result = 'text'
          this.onload?.()
        })
      }
    } as unknown as typeof FileReader

    const good = new File([new Uint8Array([1])], 'good.png', { type: 'image/png' })
    const bad = new File([new Uint8Array([2])], 'bad.png', { type: 'image/png' })
    const gate = attachmentGate(['image'])

    const { pending, rejected, notedFailures } = await filesToAttachments([good, bad], gate)

    // The good file survives the batch even though its sibling failed to read…
    expect(pending.map((p) => p.attachment.name)).toEqual([
      'good.png',
      'bad.png (attachment error).txt',
    ])
    // …and the bad file is reported, not silently dropped.
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toContain('bad.png')
    expect(notedFailures).toBe(1)
    const failureNote = pending[1]!.attachment
    expect(failureNote.kind).toBe('text')
    if (failureNote.kind === 'text') {
      expect(failureNote.text).toContain('Attachment "bad.png" could not be attached')
      expect(failureNote.text).toContain('Error fetching content: read failed')
    }
    // The surviving file keeps a revocable preview URL; the failed read minted none,
    // so nothing is orphaned (created count === staged previews).
    expect(pending[0]!.previewUrl).toBeDefined()
    expect(created).toEqual([pending[0]!.previewUrl!])
  })
})

describe('acceptAttribute', () => {
  const TEXT = '.txt,.md,.json,.csv,.log,.xml,.yaml,.yml,text/*'

  test('text-only gate → just the text accept list', () => {
    expect(
      acceptAttribute({
        allowImages: false,
        allowPdf: false,
        allowAudio: false,
        allowDocuments: false,
      }),
    ).toBe(TEXT)
  })

  test('images prepend the image mimes', () => {
    expect(
      acceptAttribute({
        allowImages: true,
        allowPdf: false,
        allowAudio: false,
        allowDocuments: false,
      }),
    ).toBe(`image/png,image/jpeg,image/gif,image/webp,${TEXT}`)
  })

  test('pdf prepends ahead of images', () => {
    expect(
      acceptAttribute({
        allowImages: true,
        allowPdf: true,
        allowAudio: false,
        allowDocuments: false,
      }),
    ).toBe(`application/pdf,image/png,image/jpeg,image/gif,image/webp,${TEXT}`)
  })

  test('documents prepend ahead of pdf + images', () => {
    expect(
      acceptAttribute({
        allowImages: true,
        allowPdf: true,
        allowAudio: false,
        allowDocuments: true,
      }),
    ).toBe(
      `.docx,.xlsx,.pptx,.odt,application/pdf,image/png,image/jpeg,image/gif,image/webp,${TEXT}`,
    )
  })

  test('the fully permissive composer gate leaves the file picker unrestricted', () => {
    expect(acceptAttribute(attachmentGate(['text']))).toBe('')
  })
})

describe('every file reaches the agent — the composer no longer refuses by type', () => {
  const gate = { allowImages: false, allowPdf: false, allowAudio: false, allowDocuments: true }
  const file = (name: string, type: string) =>
    new File([new Uint8Array([1, 2, 3, 4])], name, { type })

  // No DOM in this runner: staging a binary goes through FileReader, so stub it the way the
  // partial-failure test above does.
  const originalReader = globalThis.FileReader
  const originalCreateUrl = globalThis.URL.createObjectURL.bind(URL)
  afterEach(() => {
    globalThis.FileReader = originalReader
    globalThis.URL.createObjectURL = originalCreateUrl
  })
  const stubReader = () => {
    globalThis.FileReader = class {
      result: string | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(_file: File) {
        queueMicrotask(() => {
          this.result = 'data:application/octet-stream;base64,AQIDBA=='
          this.onload?.()
        })
      }
      readAsText(_file: File) {
        queueMicrotask(() => {
          this.result = 'text'
          this.onload?.()
        })
      }
    } as unknown as typeof FileReader
    globalThis.URL.createObjectURL = () => 'blob:stub'
  }

  test('a PDF is accepted even when the model declares no pdf modality', async () => {
    stubReader()
    // The reported failure: "Skipped 1 file(s): AGENT_IMPROVER.pdf: model has no PDF support",
    // while a .docx beside it was accepted by the very same extraction pipeline.
    const { pending, rejected } = await filesToAttachments(
      [file('spec.pdf', 'application/pdf')],
      gate,
    )
    expect(rejected).toEqual([])
    expect(pending).toHaveLength(1)
    expect(pending[0]!.attachment.kind).toBe('file')
  })

  test('an image is attached even when the gate says there is no vision support', async () => {
    stubReader()
    const { pending, rejected } = await filesToAttachments([file('diagram.png', 'image/png')], gate)
    expect(rejected).toEqual([])
    expect(pending).toHaveLength(1)
    expect(pending[0]!.attachment).toMatchObject({
      kind: 'file',
      mediaType: 'application/octet-stream',
    })
  })

  test('audio is attached even when the gate says there is no audio support', async () => {
    stubReader()
    const { pending, rejected } = await filesToAttachments(
      [file('recording.wav', 'audio/wav')],
      gate,
    )
    expect(rejected).toEqual([])
    expect(pending).toHaveLength(1)
    expect(pending[0]!.attachment).toMatchObject({ kind: 'file', mediaType: 'audio/wav' })
  })

  test('video and unknown binaries are staged as files instead of being refused', async () => {
    stubReader()
    const picked = [
      file('clip.mp4', 'video/mp4'),
      file('archive.zip', 'application/zip'),
      file('blob.bin', ''),
    ]
    const { pending, rejected } = await filesToAttachments(picked, gate)
    expect(rejected).toEqual([])
    expect(pending.map((p) => p.attachment.kind)).toEqual(['file', 'file', 'file'])
    // An absent browser type must not become a lie; octet-stream is the honest default.
    expect((pending[2]!.attachment as { mediaType: string }).mediaType).toBe(
      'application/octet-stream',
    )
  })
})

describe('large files use the content-addressed media store', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const largeFile = (name = 'oversized.bin'): File =>
    ({
      name,
      type: 'application/octet-stream',
      // Larger than the deleted 8 MiB refusal, without allocating a matching test buffer.
      size: 8 * 1024 * 1024 + 1,
    }) as File

  test('a formerly oversized file attaches by media id', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'sha256.bin',
          name: 'oversized.bin',
          size: 8 * 1024 * 1024 + 1,
          mediaType: 'application/octet-stream',
        }),
      }) as unknown as Response) as unknown as typeof fetch

    const { pending, rejected, notedFailures } = await filesToAttachments(
      [largeFile()],
      attachmentGate(['text']),
    )

    expect(rejected).toEqual([])
    expect(notedFailures).toBe(0)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.attachment).toMatchObject({
      kind: 'file',
      mediaId: 'sha256.bin',
      name: 'oversized.bin',
    })
    expect('data' in pending[0]!.attachment && pending[0]!.attachment.data).toBeFalsy()
  })

  test('an upload failure stays rejected and stages an explanatory note', async () => {
    globalThis.fetch = (async () => {
      throw new Error('storage unavailable')
    }) as unknown as typeof fetch

    const { pending, rejected, notedFailures } = await filesToAttachments(
      [largeFile('offline.bin')],
      attachmentGate(['text']),
    )

    // The thrown `storage unavailable` never reaches a person now: `apiFetch` classifies a
    // transport failure and keeps the original in the error's `detail`.
    expect(rejected).toEqual(['offline.bin: Cannot reach the Localix server.'])
    expect(notedFailures).toBe(1)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.attachment.kind).toBe('text')
    if (pending[0]!.attachment.kind === 'text') {
      expect(pending[0]!.attachment.text).toContain(
        'Error fetching content: Cannot reach the Localix server.',
      )
    }
  })
})

describe('desktop path handoff', () => {
  test('native picks stage direct paths without reading or uploading bytes', async () => {
    const realFileReader = globalThis.FileReader
    const realFetch = globalThis.fetch
    let reads = 0
    let uploads = 0
    globalThis.FileReader = class {
      readAsDataURL() {
        reads += 1
      }
      readAsText() {
        reads += 1
      }
    } as unknown as typeof FileReader
    globalThis.fetch = (async () => {
      uploads += 1
      throw new Error('native path attachments must not upload')
    }) as unknown as typeof fetch

    try {
      const files = filesFromDesktopPick({
        paths: ['/Users/me/Downloads/notes.log', 'C:\\Users\\me\\Downloads\\diagram.png'],
      })
      const { pending, rejected, notedFailures } = await filesToAttachments(
        files ?? [],
        attachmentGate(['text']),
      )

      expect(reads).toBe(0)
      expect(uploads).toBe(0)
      expect(rejected).toEqual([])
      expect(notedFailures).toBe(0)
      expect(pending.map((item) => item.attachment)).toMatchObject([
        {
          kind: 'path',
          path: '/Users/me/Downloads/notes.log',
          name: 'notes.log',
          size: 0,
        },
        {
          kind: 'path',
          path: 'C:\\Users\\me\\Downloads\\diagram.png',
          mediaType: 'image/png',
          name: 'diagram.png',
          size: 0,
        },
      ])
      expect(pending[0]!.attachment.kind).toBe('path')
      if (pending[0]!.attachment.kind === 'path') {
        expect(pending[0]!.attachment.mediaType).toStartWith('text/plain')
      }
    } finally {
      globalThis.FileReader = realFileReader
      globalThis.fetch = realFetch
    }
  })

  test('cancel stages nothing and no desktop shell preserves the browser fallback signal', () => {
    expect(filesFromDesktopPick({ paths: [] })).toEqual([])
    expect(filesFromDesktopPick(undefined)).toBeUndefined()
  })

  test('a recovered path stages without reading, uploading, or applying a size ceiling', async () => {
    const file = {
      name: 'huge.log',
      type: 'text/plain',
      size: 50 * 1024 * 1024,
    } as File
    rememberDroppedFilePath(file, '/Users/me/Downloads/huge.log')

    const { pending, rejected, notedFailures } = await filesToAttachments(
      [file],
      attachmentGate(['text']),
    )

    expect(rejected).toEqual([])
    expect(notedFailures).toBe(0)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.attachment).toEqual({
      kind: 'path',
      path: '/Users/me/Downloads/huge.log',
      mediaType: 'text/plain',
      name: 'huge.log',
      size: 50 * 1024 * 1024,
    })
  })

  test('without a recovered path the existing byte materialization is unchanged', async () => {
    const realFileReader = globalThis.FileReader
    globalThis.FileReader = class {
      result: string | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsText(_file: File) {
        queueMicrotask(() => {
          this.result = 'hello'
          this.onload?.()
        })
      }
    } as unknown as typeof FileReader
    try {
      const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
      const { pending, rejected } = await filesToAttachments([file], attachmentGate(['text']))

      expect(rejected).toEqual([])
      expect(pending[0]!.attachment).toEqual({
        kind: 'text',
        text: 'hello',
        name: 'note.txt',
        size: 5,
      })
    } finally {
      globalThis.FileReader = realFileReader
    }
  })
})

describe('explicit caller policy', () => {
  test('the HITL-style document opt-out remains a rejection', async () => {
    const gate = { allowImages: true, allowPdf: false, allowAudio: false, allowDocuments: false }
    const document = new File([new Uint8Array([1])], 'reference.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const { pending, rejected, notedFailures } = await filesToAttachments([document], gate)

    expect(pending).toEqual([])
    expect(rejected).toEqual(['reference.docx: document attachments are disabled'])
    expect(notedFailures).toBe(0)
  })
})
