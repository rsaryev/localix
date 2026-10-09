import { pluginApiFetch, unwrapPluginResponse } from '@localixai/plugin-sdk/ui/transport'
import type { MotionDocument, MotionAsset } from '../shared/schema'

export async function mediaBlob(id: string, signal?: AbortSignal, sessionId?: string) {
  const response = await pluginApiFetch(
    `/rpc/motion/assets/${id}${sessionId ? `?${new URLSearchParams({ sessionId })}` : ''}`,
    { signal },
  )
  if (!response.ok) await unwrapPluginResponse(response)
  return response.blob()
}
export async function loadImages(
  document: MotionDocument,
  signal?: AbortSignal,
  sessionId?: string,
) {
  const ids = new Set(
    document.scenes
      .flatMap((scene) => [
        scene.imageId,
        ...scene.layers.filter((layer) => layer.kind === 'image').map((layer) => layer.assetId),
      ])
      .filter((id): id is string => id !== null),
  )
  const entries = await Promise.all(
    [...ids].map(async (id) => {
      const blob = await mediaBlob(id, signal, sessionId)
      const url = URL.createObjectURL(blob)
      try {
        const image = new Image()
        image.src = url
        await image.decode()
        if (signal?.aborted) throw signal.reason
        return [id, image] as const
      } finally {
        URL.revokeObjectURL(url)
      }
    }),
  )
  return new Map(entries)
}
export async function assetPayload(file: File) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a file under 25 MiB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  const mime =
    file.type === 'audio/x-wav' ? 'audio/wav' : file.type === 'audio/mp3' ? 'audio/mpeg' : file.type
  return { name: file.name, mime: mime as MotionAsset['mime'], base64: btoa(binary) }
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name.replace(/[\\/:*?"<>|]/gu, '-')
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
