import type { MotionScene } from './schema'
import type { Painter, FilmPalette } from './graphics'
import { spatialStage } from './spatial-context'
import { showcase } from './spatial-showcase'
import { typeset } from './spatial-type'
import { token } from './spatial-token'
import { gather } from './spatial-gather'
import { chart } from './spatial-chart'
import { portfolio } from './spatial-portfolio'
import { texture } from './spatial-textures'
import { drawLayout } from './layouts'
import { sampleLayer } from './timing'
import { paintLayer } from './layer-painter'

export function drawSpatialScene(
  ctx: Painter,
  scene: MotionScene,
  time: number,
  p: FilmPalette,
  images: ReadonlyMap<string, CanvasImageSource>,
) {
  const stage = spatialStage(ctx, scene, time, p)
  const image = scene.imageId ? images.get(scene.imageId) : undefined
  if (scene.layout === 'showcase') showcase(stage, image)
  else if (scene.layout === 'typeset') typeset(stage)
  else if (scene.layout === 'token') token(stage)
  else if (scene.layout === 'gather') gather(stage)
  else if (scene.layout === 'chart') chart(stage)
  else if (scene.layout === 'portfolio') portfolio(stage, image)
  else {
    const { w, h } = stage
    const surface = texture(scene, `layout:${w}:${h}:${p.background}`, w, h, () => {})
    const painter = surface.getContext('2d') as Painter
    painter.clearRect(0, 0, w, h)
    drawLayout(painter, scene, Math.min(time, scene.duration * 0.84), w, h, p, images)
    stage.plane(surface, w / h, 1, { x: 0, y: 0, z: 0 })
  }
  for (const layer of scene.layers) {
    const key = sampleLayer(layer.keyframes, time)
    const width = Math.max(1, Math.round(layer.width * stage.w)),
      height = Math.max(1, Math.round(layer.height * stage.h))
    const canvas = texture(scene, `layer:${layer.id}:${width}:${height}`, width, height, () => {})
    const painter = canvas.getContext('2d') as Painter
    painter.clearRect(0, 0, width, height)
    painter.save()
    painter.translate(width / 2, height / 2)
    paintLayer(
      painter,
      layer,
      width,
      height,
      layer.fontSize * Math.min(stage.w, stage.h),
      p[layer.color],
      images,
    )
    painter.restore()
    stage.plane(
      canvas,
      ((layer.width * stage.w) / stage.h) * key.scale,
      layer.height * key.scale,
      {
        x: ((key.x - 0.5) * stage.w) / stage.h,
        y: key.y - 0.5,
        z: layer.depth,
        pitch: layer.tiltX,
        yaw: layer.tiltY,
        roll: key.rotation,
      },
      key.opacity,
    )
  }
  stage.render()
}
