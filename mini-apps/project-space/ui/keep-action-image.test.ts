import { expect, test } from 'bun:test'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { keepActionImage } from './keep-action-image'

test('generated media and inline images are kept as files; remote URLs and project paths remain references', async () => {
  const requests: string[] = []
  const bodies: Blob[] = []
  const unbind = bindMiniAppUiTransport({
    url: (path) => `https://local.test${path}`,
    request: async (path, init) => {
      requests.push(path)
      if (path.startsWith('/rpc/media/'))
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
      expect(new URL(path, 'https://local.test').searchParams.get('sessionId')).toBe('origin-chat')
      bodies.push(init?.body as Blob)
      return Response.json({ path: '.localix/project-space/files/image.png' })
    },
  })
  try {
    expect(await keepActionImage('origin-chat', 'https://local.test/rpc/media/image-id')).toEqual({
      path: '.localix/project-space/files/image.png',
    })
    expect(await keepActionImage('origin-chat', 'data:image/png;base64,AQID')).toEqual({
      path: '.localix/project-space/files/image.png',
    })
    expect(await keepActionImage('origin-chat', 'https://remote.test/rpc/media/image-id')).toEqual({
      url: 'https://remote.test/rpc/media/image-id',
    })
    expect(await keepActionImage('origin-chat', 'assets/photo.png')).toEqual({
      path: 'assets/photo.png',
    })
    expect(requests).toHaveLength(3)
    expect(requests[0]).toBe('/rpc/media/image-id')
    expect(Array.from(new Uint8Array(await bodies[0]!.arrayBuffer()))).toEqual([1, 2, 3])
    expect(Array.from(new Uint8Array(await bodies[1]!.arrayBuffer()))).toEqual([1, 2, 3])
  } finally {
    unbind()
  }
})
test('failed media and non-image responses never create files', async () => {
  const requests: string[] = []
  const unbind = bindMiniAppUiTransport({
    url: (path) => `https://local.test${path}`,
    request: async (path) => {
      requests.push(path)
      return new Response('not an image', { headers: { 'content-type': 'text/plain' } })
    },
  })
  try {
    await expect(keepActionImage('s', '/rpc/media/id')).rejects.toThrow('could not be read')
    await expect(keepActionImage('s', 'data:image/png;base64,???')).rejects.toThrow('invalid')
    expect(requests).toEqual(['/rpc/media/id'])
  } finally {
    unbind()
  }
})
