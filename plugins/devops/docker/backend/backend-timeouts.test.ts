/**
 * A slow Docker action gets a deadline it can meet.
 *
 * One 10s cap on every CLI call killed `docker stop` while it waited out the container's own 10s
 * grace period, and `compose up` while it pulled images — both reported "timed out" on work that
 * was still going. These pin which calls carry the longer budget, and that a read keeps the short
 * default.
 */
import { describe, expect, test } from 'bun:test'
import {
  DOCKER_CLI_ACTION_TIMEOUT_MS,
  DOCKER_COMPOSE_UP_TIMEOUT_MS,
  createDockerBackend,
  type DockerExec,
} from './backend'

function recordingExec(): { exec: DockerExec; timeouts: Map<string, number | undefined> } {
  const timeouts = new Map<string, number | undefined>()
  const exec: DockerExec = async (args, opts) => {
    timeouts.set(args.slice(0, 2).join(' '), opts?.timeoutMs)
    if (args[0] === 'ps') {
      return `${JSON.stringify({ Labels: 'com.docker.compose.project.working_dir=/srv/app' })}\n`
    }
    return ''
  }
  return { exec, timeouts }
}

describe('docker CLI timeouts', () => {
  test('stop, restart and prune get the action budget; compose up gets minutes', async () => {
    const { exec, timeouts } = recordingExec()
    const backend = createDockerBackend({ exec })
    await backend.stopContainer('c1')
    await backend.restartContainer('c1')
    await backend.prune('images')
    await backend.composeUp('app')
    expect(timeouts.get('stop c1')).toBe(DOCKER_CLI_ACTION_TIMEOUT_MS)
    expect(timeouts.get('restart c1')).toBe(DOCKER_CLI_ACTION_TIMEOUT_MS)
    expect(timeouts.get('image prune')).toBe(DOCKER_CLI_ACTION_TIMEOUT_MS)
    expect(timeouts.get('compose -p')).toBe(DOCKER_COMPOSE_UP_TIMEOUT_MS)
  })

  test('a quick call keeps the short default', async () => {
    const { exec, timeouts } = recordingExec()
    await createDockerBackend({ exec }).startContainer('c1')
    expect(timeouts.get('start c1')).toBeUndefined()
  })
})
