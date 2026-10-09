import type { MotionScene } from './schema'

export function retimeScene(scene: MotionScene, duration: number): MotionScene {
  const ratio = duration / scene.duration
  return {
    ...scene,
    duration,
    camera: scene.camera
      ? {
          ...scene.camera,
          frames: scene.camera.frames.map((frame) => ({ ...frame, time: frame.time * ratio })),
        }
      : null,
    layers: scene.layers.map((layer) => ({
      ...layer,
      keyframes: layer.keyframes.map((frame) => ({ ...frame, time: frame.time * ratio })),
    })),
  }
}
