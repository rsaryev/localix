import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  QUALITY_HIGH,
} from 'mediabunny'
import type { MotionDocument } from '../shared/schema'
import { dimensions, durationOf, framesOf } from '../shared/timing'
import { renderFrame } from '../shared/render'
import { loadImages, mediaBlob } from './media'

export type VideoFormat = 'mp4' | 'webm'
export async function exportSupport(document: MotionDocument, size: number, format: VideoFormat) {
  const { width, height } = dimensions(document.format, size)
  const codecs = format === 'mp4' ? (['avc'] as const) : (['vp9', 'vp8'] as const)
  for (const codec of codecs) {
    if (await canEncodeVideo(codec, { width, height, bitrate: QUALITY_HIGH })) {
      if (
        document.soundtrackId &&
        !(await canEncodeAudio(format === 'mp4' ? 'aac' : 'opus', {
          sampleRate: 48000,
          numberOfChannels: 2,
        }))
      )
        return null
      return codec
    }
  }
  return null
}
async function soundtrack(document: MotionDocument, signal: AbortSignal, sessionId?: string) {
  const duration = durationOf(document)
  const offline = new OfflineAudioContext(2, Math.ceil(duration * 48000), 48000)
  const blob = await mediaBlob(document.soundtrackId!, signal, sessionId)
  const decoded = await offline.decodeAudioData(await blob.arrayBuffer())
  const source = offline.createBufferSource()
  source.buffer = decoded
  const gain = offline.createGain()
  gain.gain.setValueAtTime(0, 0)
  gain.gain.linearRampToValueAtTime(document.volume, 0.15)
  gain.gain.setValueAtTime(document.volume, Math.max(0.15, duration - 0.4))
  gain.gain.linearRampToValueAtTime(0, duration)
  source.connect(gain).connect(offline.destination)
  source.start()
  return offline.startRendering()
}
export async function exportVideo(
  document: MotionDocument,
  options: {
    sessionId?: string
    format: VideoFormat
    size: number
    signal: AbortSignal
    onProgress: (percent: number) => void
  },
) {
  const { format, size, signal, onProgress } = options
  const codec = await exportSupport(document, size, format)
  if (!codec)
    throw new Error(
      `This browser cannot encode ${format.toUpperCase()} at this size${document.soundtrackId ? ' with audio' : ''}. Try another format or a smaller size.`,
    )
  const images = await loadImages(document, signal, options.sessionId)
  const audio = document.soundtrackId ? await soundtrack(document, signal, options.sessionId) : null
  signal.throwIfAborted()
  await globalThis.document.fonts.ready
  const canvas = globalThis.document.createElement('canvas')
  Object.assign(canvas, dimensions(document.format, size))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Video rendering is unavailable in this browser.')
  const target = new BufferTarget()
  const output = new Output({
    target,
    format:
      format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
  })
  const video = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH })
  output.addVideoTrack(video, { frameRate: document.fps })
  const audioSource = audio
    ? new AudioBufferSource({ codec: format === 'mp4' ? 'aac' : 'opus', bitrate: QUALITY_HIGH })
    : null
  if (audioSource) output.addAudioTrack(audioSource)
  try {
    await output.start()
    // Interleave chunks of audio and frames so muxing never accumulates the whole soundtrack.
    const count = framesOf(document)
    for (let frame = 0; frame < count; frame++) {
      signal.throwIfAborted()
      renderFrame(ctx, document, frame, images)
      await video.add(frame / document.fps, 1 / document.fps, {
        keyFrame: frame % (document.fps * 2) === 0,
      })
      if (audio && audioSource && frame % document.fps === 0) {
        const start = Math.floor((frame / document.fps) * audio.sampleRate)
        const length = Math.min(audio.sampleRate, audio.length - start)
        if (length > 0) {
          const chunk = new AudioBuffer({
            length,
            sampleRate: audio.sampleRate,
            numberOfChannels: audio.numberOfChannels,
          })
          for (let channel = 0; channel < audio.numberOfChannels; channel++)
            chunk.copyToChannel(
              audio.getChannelData(channel).subarray(start, start + length),
              channel,
            )
          await audioSource.add(chunk)
        }
      }
      if (frame % 10 === 0) {
        onProgress((frame / count) * 100)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    video.close()
    audioSource?.close()
    await output.finalize()
    signal.throwIfAborted()
    onProgress(100)
    return new Blob([target.buffer!], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' })
  } catch (error) {
    await output.cancel().catch(() => {})
    throw error
  }
}
