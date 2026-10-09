import type { MotionLayer } from './schema'
import { circle, drawImageCover, fittedText, roundRect, type Painter } from './graphics'
import { ring, rosette, orbitalMark } from './motifs'
import { apertureFrame, stageGrid } from './dark-primitives'

export function paintLayer(
  ctx: Painter,
  layer: MotionLayer,
  width: number,
  height: number,
  fontSize: number,
  color: string,
  images: ReadonlyMap<string, CanvasImageSource>,
) {
  if (layer.kind === 'text')
    fittedText(ctx, layer.text, 0, -height / 2, width, fontSize, color, {
      align: 'center',
      maxLines: 5,
    })
  else if (layer.kind === 'circle') circle(ctx, 0, 0, Math.min(width, height) / 2, color)
  else if (layer.kind === 'rectangle')
    roundRect(ctx, -width / 2, -height / 2, width, height, Math.min(width, height) * 0.08, color)
  else if (layer.kind === 'line')
    roundRect(ctx, -width / 2, -height * 0.04, width, height * 0.08, height * 0.04, color)
  else if (layer.kind === 'ring') ring(ctx, Math.min(width, height) / 2, color)
  else if (layer.kind === 'rosette') rosette(ctx, Math.min(width, height) / 2, color)
  else if (layer.kind === 'orbit') orbitalMark(ctx, Math.min(width, height) / 2, 1, color)
  else if (layer.kind === 'grid' || layer.kind === 'frame') {
    ctx.translate(-width / 2, -height / 2)
    if (layer.kind === 'grid') stageGrid(ctx, width, height, color)
    else apertureFrame(ctx, width, height, color)
  } else if (layer.assetId && images.has(layer.assetId))
    drawImageCover(ctx, images.get(layer.assetId)!, -width / 2, -height / 2, width, height)
}
