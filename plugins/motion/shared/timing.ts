import type { Keyframe, MotionDocument } from './schema'

export const durationOf = (document: MotionDocument) =>
  document.scenes.reduce((sum, scene) => sum + scene.duration, 0)
export const framesOf = (document: MotionDocument) => Math.ceil(durationOf(document) * document.fps)
export function dimensions(format: MotionDocument['format'], size = 1080) {
  return format === 'portrait'
    ? { width: size, height: Math.round((size * 16) / 9) }
    : format === 'square'
      ? { width: size, height: size }
      : { width: Math.round((size * 16) / 9), height: size }
}
export function sceneAt(document: MotionDocument, time: number) {
  let start = 0
  for (let index = 0; index < document.scenes.length; index++) {
    const scene = document.scenes[index]!
    if (time < start + scene.duration || index === document.scenes.length - 1)
      return { scene, index, start, local: Math.max(0, Math.min(scene.duration, time - start)) }
    start += scene.duration
  }
  throw new Error('A motion project needs a scene.')
}
export function ease(value: number, kind: Keyframe['easing'] = 'out') {
  const t = Math.min(1, Math.max(0, value))
  if (kind === 'linear') return t
  if (kind === 'smooth') return t * t * (3 - 2 * t)
  if (kind === 'spring') return t === 0 || t === 1 ? t : 1 - Math.cos(t * 10) * Math.exp(-t * 8)
  return 1 - (1 - t) ** 4
}
export function sampleLayer(frames: Keyframe[], time: number): Keyframe {
  const first = frames[0]!
  if (time <= first.time) return first
  const end = frames.findIndex((frame) => frame.time >= time)
  if (end < 0) return frames[frames.length - 1]!
  const a = frames[end - 1]!
  const b = frames[end]!
  const t = ease((time - a.time) / (b.time - a.time), b.easing)
  const lerp = (x: number, y: number) => x + (y - x) * t
  return {
    ...b,
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    scale: lerp(a.scale, b.scale),
    rotation: lerp(a.rotation, b.rotation),
    opacity: Math.min(1, Math.max(0, lerp(a.opacity, b.opacity))),
  }
}
