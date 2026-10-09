import type { MotionDocument, MotionScene } from './schema'
import { palettes, fittedText, roundRect, circle, drawImageCover, type Painter } from './graphics'
import { sceneAt, sampleLayer } from './timing'
import { drawLayout } from './layouts'
import { ring, rosette, orbitalMark } from './motifs'
import { apertureFrame, stageGrid } from './dark-primitives'

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
    const color = palette[layer.color]
    if (layer.kind === 'text')
      fittedText(ctx, layer.text, 0, -lh / 2, lw, layer.fontSize * Math.min(w, h), color, {
        align: 'center',
        maxLines: 5,
      })
    else if (layer.kind === 'circle') circle(ctx, 0, 0, Math.min(lw, lh) / 2, color)
    else if (layer.kind === 'rectangle')
      roundRect(ctx, -lw / 2, -lh / 2, lw, lh, Math.min(lw, lh) * 0.08, color)
    else if (layer.kind === 'line')
      roundRect(ctx, -lw / 2, -lh * 0.04, lw, lh * 0.08, lh * 0.04, color)
    else if (layer.kind === 'ring') ring(ctx, Math.min(lw, lh) / 2, color)
    else if (layer.kind === 'rosette') rosette(ctx, Math.min(lw, lh) / 2, color)
    else if (layer.kind === 'orbit') orbitalMark(ctx, Math.min(lw, lh) / 2, 1, color)
    else if (layer.kind === 'grid' || layer.kind === 'frame') {
      ctx.translate(-lw / 2, -lh / 2)
      if (layer.kind === 'grid') stageGrid(ctx, lw, lh, color)
      else apertureFrame(ctx, lw, lh, color)
    } else if (layer.assetId && images.has(layer.assetId))
      drawImageCover(ctx, images.get(layer.assetId)!, -lw / 2, -lh / 2, lw, lh)
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
