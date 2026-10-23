import { awaitBunChildGone, toolEnv } from '@localixai/mini-app-sdk/backend'
import type { WsFrameContribution } from '@localixai/mini-app-sdk/backend'
import { createLogFollowHub, type LogFollowHub, type LogSource } from '../../backend/log-follow'
import {
  DOCKER_LOGS_SUBSCRIBE,
  DOCKER_LOGS_UNSUBSCRIBE,
  LOG_FOLLOW_FRAME_TAG,
  dockerLogKey,
  dockerLogTarget,
  type DockerLogTarget,
} from '../../backend/log-follow-contract'

interface FollowChild {
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<number>
  kill(signal?: NodeJS.Signals | number): void
}

export type SpawnDockerLogs = (containerId: string) => FollowChild

/** New output only: the tab already holds the tail; this child just says when there is more. */
export const dockerLogsCommand = (containerId: string) => [
  'docker',
  'logs',
  '--follow',
  '--tail',
  '0',
  containerId,
]

const defaultSpawn: SpawnDockerLogs = (containerId) =>
  // `env` as for `docker events`: the packaged app's PATH may not have the CLI's directory.
  Bun.spawn(dockerLogsCommand(containerId), {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
    env: toolEnv(),
  })

/**
 * One `docker logs --follow` child per followed container, while a tab follows it. A container's
 * stderr is the child's stderr, so both pipes count as growth. A stopped container's child exits
 * at once, so it is never called live and the tab polls nothing (it polls only running ones).
 */
export function createDockerLogsHub(spawn: SpawnDockerLogs = defaultSpawn) {
  return createLogFollowHub<DockerLogTarget>({
    keyOf: dockerLogKey,
    open: ({ containerId }): LogSource => {
      const child = spawn(containerId)
      return {
        output: [child.stdout, child.stderr],
        close: () => void awaitBunChildGone(child),
      }
    },
  })
}

export function createDockerLogsWsFrame(hub: LogFollowHub<DockerLogTarget>): WsFrameContribution {
  return {
    subscribeCommand: DOCKER_LOGS_SUBSCRIBE,
    unsubscribeCommand: DOCKER_LOGS_UNSUBSCRIBE,
    frameTag: LOG_FOLLOW_FRAME_TAG,
    key: (params) => {
      const target = dockerLogTarget(params)
      return target ? dockerLogKey(target) : 'docker\n'
    },
    start: (params, send) => {
      const target = dockerLogTarget(params)
      if (!target) throw new Error('invalid container id')
      return hub.subscribe(target, (frame) => send(JSON.stringify(frame)))
    },
    stop: (handle) => {
      if (typeof handle === 'function') (handle as () => void)()
    },
  }
}
