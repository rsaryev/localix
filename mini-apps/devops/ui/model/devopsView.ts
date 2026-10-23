import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

export const DEVOPS_AREA_KEY = 'localix.devops.area'

export type DevOpsArea = 'overview' | 'containers' | 'kubernetes'

const AREAS = new Set<DevOpsArea>(['overview', 'containers', 'kubernetes'])

/** Normalize persisted or externally supplied navigation state. */
export function normalizeDevOpsArea(value: unknown): DevOpsArea {
  return typeof value === 'string' && AREAS.has(value as DevOpsArea)
    ? (value as DevOpsArea)
    : 'overview'
}

export function loadDevOpsArea(): DevOpsArea {
  return normalizeDevOpsArea(loadString(DEVOPS_AREA_KEY))
}

export function saveDevOpsArea(area: DevOpsArea): void {
  saveString(DEVOPS_AREA_KEY, area)
}
