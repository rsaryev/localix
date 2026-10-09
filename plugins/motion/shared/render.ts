import { spatialLayouts, type MotionDocument, type MotionScene } from './schema'
import { palettes, type Painter } from './graphics'
import { sceneAt, sampleLayer } from './timing'
import { drawLayout } from './layouts'
import { paintLayer } from './layer-painter'
import { drawSpatialScene } from './spatial-scenes'

function drawScene(
  ctx: Painter,
  scene: MotionScene,
  time: number,
  w: number,
  h: number,
  document: MotionDocument,
  images: ReadonlyMap<string, CanvasImageSource>,
) {
  const palette = palettes[scene.palette ?? document.palette]
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, w, h)
  if (scene.camera || (spatialLayouts as readonly string[]).includes(scene.layout)) {
    drawSpatialScene(ctx, scene, time, palette, images)
    return
  }
  drawLayout(ctx, scene, time, w, h, palette, images)
  for (const layer of scene.layers) {
    const transform = sampleLayer(layer.keyframes, time)
    ctx.save()
    ctx.translate(transform.x * w, transform.y * h)
    ctx.rotate((transform.rotation * Math.PI) / 180)
    ctx.scale(transform.scale, transform.scale)
    ctx.globalAlpha *= transform.opacity
    const lw = layer.width * w
    const lh = layer.height * h
    paintLayer(ctx, layer, lw, lh, layer.fontSize * Math.min(w, h), palette[layer.color], images)
    ctx.restore()
  }
}
export function renderFrame(
  ctx: Painter,
  document: MotionDocument,
  frame: number,
  images: ReadonlyMap<string, CanvasImageSource> = new Map(),
) {
  const { width: w, height: h } = ctx.canvas
  const time = Math.max(0, frame) / document.fps
  const current = sceneAt(document, time)
  ctx.save()
  ctx.clearRect(0, 0, w, h)
  drawScene(ctx, current.scene, current.local, w, h, document, images)
  const transitionDuration = Math.min(0.4, current.scene.duration / 4)
  if (
    current.index > 0 &&
    current.local < transitionDuration &&
    current.scene.transition !== 'cut'
  ) {
    const previous = document.scenes[current.index - 1]!
    const p = current.local / transitionDuration
    if (current.scene.transition === 'fade') ctx.globalAlpha = 1 - p
    else {
      ctx.beginPath()
      ctx.rect(w * p, 0, w * (1 - p), h)
      ctx.clip()
    }
    drawScene(ctx, previous, previous.duration, w, h, document, images)
  }
  ctx.restore()
}
