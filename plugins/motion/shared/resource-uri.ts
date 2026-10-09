import { idSchema } from './schema'
export const MOTION_ROOT = 'localix://resource/motion'
export const motionUri = (id: string) => `${MOTION_ROOT}/${id}`
export function parseMotionUri(uri: string) {
  if (!uri.startsWith(`${MOTION_ROOT}/`)) return null
  const parsed = idSchema.safeParse(uri.slice(MOTION_ROOT.length + 1))
  return parsed.success ? parsed.data : null
}
