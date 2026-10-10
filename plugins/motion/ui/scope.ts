import { pluginApiUrl } from '@localixai/plugin-sdk/ui/transport'
import { motionFileUrl, type MotionFile, type MotionProject } from '../shared/contract'

/** Every Motion route but `/view` is scoped to the conversation by `?sessionId=`. */
export const motionPath = (sessionId: string, path: string) =>
  `${path}?${new URLSearchParams({ sessionId })}`

/** A file of the project, relative to its folder (`renders/launch.mp4`). */
export function projectFile(project: MotionProject, file: MotionFile, folder: string) {
  const prefix = `${project.path.replace(/\/+$/u, '')}/`
  return file.path.startsWith(prefix) ? file.path.slice(prefix.length) : `${folder}/${file.name}`
}

/** A browser-loadable URL for one of the project's files. */
export const projectFileUrl = (_sessionId: string, project: MotionProject, file?: string) =>
  pluginApiUrl(motionFileUrl(project, file))
