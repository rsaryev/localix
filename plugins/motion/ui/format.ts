import type { MotionProject } from '../shared/contract'

export function formatSeconds(seconds: number | null) {
  if (seconds === null) return 'No duration'
  if (seconds < 60) return `${Number(seconds.toFixed(1))}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

export function formatName({ width, height }: Pick<MotionProject, 'width' | 'height'>) {
  if (width === height) return 'Square'
  return width > height ? 'Landscape' : 'Portrait'
}

export const formatSize = ({ width, height }: Pick<MotionProject, 'width' | 'height'>) =>
  `${width}×${height}`

export const sceneCount = (count: number) => `${count} ${count === 1 ? 'scene' : 'scenes'}`

/** The newest render first; the list order on disk is not a promise. */
export const newestFirst = <T extends { updatedAt: string }>(files: readonly T[]) =>
  [...files].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
