import { dockerApi } from '../dockerApi'

let availableCache: boolean | null = null
let availableRequest: Promise<boolean> | null = null

/** Process-lifetime capability probe shared by every Docker workbench surface. */
export function readDockerComposeAvailable(): Promise<boolean> {
  if (availableCache !== null) return Promise.resolve(availableCache)
  if (availableRequest) return availableRequest
  availableRequest = dockerApi
    .composeAvailable()
    .then((available) => {
      availableCache = available
      return available
    })
    .finally(() => {
      availableRequest = null
    })
  return availableRequest
}

export function cachedDockerComposeAvailable(): boolean {
  return availableCache ?? false
}
