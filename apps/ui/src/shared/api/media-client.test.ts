/**
 * `uploadMedia`'s failure messages.
 *
 * `fileDropRouter` puts the thrown message straight into the toast ("Could not open “X”", with "X — <reason>" underneath)
 * and its comment says why: "a swallowed reason turns every failure mode into the same unactionable
 * toast". The client defeated that — it threw `media upload failed (413)` and dropped the body. And
 * for the size case there is no body to read: `Bun.serve` answers an oversized upload with a 413 that
 * has an empty body (see `apps/api/src/lib/request-limits.test.ts`), so the reason has to come from
 * here or from nowhere.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { MAX_REQUEST_BODY_BYTES } from '@localixai/api/client'
import { uploadMedia } from './media-client'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** A File-like stand-in: only `name`, `size` and `type` are read before the request. */
const fileOf = (size: number, name = 'clip.mp4'): File =>
  ({ name, size, type: 'video/mp4' }) as File

const reply = (status: number, body: unknown, ok = status < 400) => {
  globalThis.fetch = (async () =>
    ({
      ok,
      status,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch
}

const reason = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    throw new Error('expected uploadMedia to reject')
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('an oversized file is refused before the request', () => {
  test('the message names both the size and the limit', async () => {
    let requested = false
    globalThis.fetch = (async () => {
      requested = true
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch

    const message = await reason(uploadMedia(fileOf(MAX_REQUEST_BODY_BYTES + 1)))
    expect(message).toContain('128 MB')
    // A file that will be refused must not be uploaded first — that is minutes of the user's time
    // spent to reach a failure already knowable from `file.size`.
    expect(requested).toBe(false)
  })

  test('a file exactly at the limit is still attempted', async () => {
    // Off-by-one here would refuse a legitimate upload, which is worse than the bug being fixed.
    reply(200, { id: 'abc.mp4', name: 'clip.mp4', size: 1, mediaType: 'video/mp4' })
    expect((await uploadMedia(fileOf(MAX_REQUEST_BODY_BYTES))).id).toBe('abc.mp4')
  })
})

describe('a failed response', () => {
  test('a 413 from something in front of us still explains itself', async () => {
    // The pre-check cannot know a proxy has a smaller cap, so this path must not degrade to a number.
    reply(413, null, false)
    const message = await reason(uploadMedia(fileOf(1024)))
    expect(message).toContain('too large')
    expect(message).toContain('128 MB')
  })

  test("the app envelope's message is preferred over the status", async () => {
    reply(
      404,
      { error: { code: 'media_not_found', message: 'No stored media with id "x"' } },
      false,
    )
    expect(await reason(uploadMedia(fileOf(1024)))).toBe('No stored media with id "x"')
  })

  test('a body that is not the envelope falls back to the status, never to undefined', async () => {
    reply(500, 'gateway exploded', false)
    const message = await reason(uploadMedia(fileOf(1024)))
    // Was `media upload failed (500)`. The number now lives in the detail, not on the line.
    expect(message).toBe('The server could not complete this.')
    expect(message).not.toContain('undefined')
  })

  test('a body that is not JSON at all still yields a message', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json')
        },
      }) as unknown as Response) as unknown as typeof fetch
    expect(await reason(uploadMedia(fileOf(1024)))).toBe('The server could not complete this.')
  })
})

describe('a successful upload', () => {
  test('returns the stored media descriptor', async () => {
    reply(200, { id: 'sha.mp4', name: 'clip.mp4', size: 1024, mediaType: 'video/mp4' })
    expect(await uploadMedia(fileOf(1024))).toEqual({
      id: 'sha.mp4',
      name: 'clip.mp4',
      size: 1024,
      mediaType: 'video/mp4',
    })
  })
})
