import { DockerApiError } from '../dockerApi'
import type { DevOpsIssue } from '../../../ui/DevOpsProblem'

/**
 * A Docker failure in the shape the problem surface speaks.
 *
 * There were three of these, identical, and all three did the same wrong thing: they joined the
 * classified sentence and the raw engine text into one string. That is how a canvas strip ended up
 * reading `connect to the docker API at unix:///Users/…/docker.sock; check if the path is correct
 * and if the daemon is running: dial unix …: connect: no such file or directory` — the backend had
 * already separated the two, and the client glued them back together.
 *
 * They stay separate now. The sentence goes on the line; the daemon's own words go to the Event
 * Center, which is where an operator reads them and where there is room for them.
 */
export function dockerIssue(error: unknown): DevOpsIssue {
  if (error instanceof DockerApiError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.detail,
      ...(error.prerequisite ? { prerequisite: error.prerequisite } : {}),
      ...(error.request ? { request: error.request } : {}),
    }
  }
  return { message: error instanceof Error ? error.message : 'Docker request failed.' }
}
