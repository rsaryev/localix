import { createRealtimeFeed, useRealtimeFeed } from '@localixai/mini-app-sdk/ui/realtime-feed'
import { runAsBackgroundWork, useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import {
  DOCKER_LOGS_SUBSCRIBE,
  DOCKER_LOGS_UNSUBSCRIBE,
  KUBE_LOGS_SUBSCRIBE,
  KUBE_LOGS_UNSUBSCRIBE,
  LOG_FOLLOW_FRAME_TAG,
  dockerLogKey,
  kubeLogKey,
  type DockerLogTarget,
  type KubeLogTarget,
  type LogFollowFrame,
} from '../../backend/log-follow-contract'

export type LogFollowTarget =
  | ({ provider: 'docker' } & DockerLogTarget)
  | ({ provider: 'k8s' } & KubeLogTarget)

export const logFollowKey = (target: LogFollowTarget): string =>
  target.provider === 'docker' ? dockerLogKey(target) : kubeLogKey(target)

function command(target: LogFollowTarget, subscribe: boolean): Record<string, unknown> {
  if (target.provider === 'docker') {
    return {
      t: subscribe ? DOCKER_LOGS_SUBSCRIBE : DOCKER_LOGS_UNSUBSCRIBE,
      containerId: target.containerId,
    }
  }
  return {
    t: subscribe ? KUBE_LOGS_SUBSCRIBE : KUBE_LOGS_UNSUBSCRIBE,
    context: target.context || undefined,
    namespace: target.namespace,
    pod: target.pod,
    containers: target.containers,
  }
}

/**
 * The browser's side of the log-growth stream (`backend/log-follow-contract.ts`). Liveness is the
 * follower's own status: live only while the runtime's follow runs, and a socket drop takes it down.
 */
export const logFollowFeed = createRealtimeFeed<LogFollowTarget, LogFollowFrame>({
  tag: LOG_FOLLOW_FRAME_TAG,
  subscribe: (target) => command(target, true),
  unsubscribe: (target) => command(target, false),
  id: logFollowKey,
  decode: (json) => JSON.parse(json) as LogFollowFrame,
  route: (frame) => frame.key,
  status: (frame) => (frame.kind === 'status' ? frame.status === 'live' : undefined),
})

/**
 * Read the new lines when the log grew, and after a gap: the follow coming up (lines printed
 * before it started), or a reconnect (lines printed while the socket was down). Background work,
 * not the person's.
 */
export function logFollower(reread: () => void) {
  const background = () => runAsBackgroundWork(reread)
  return {
    frame: (frame: LogFollowFrame) => {
      if (frame.kind === 'grew') background()
    },
    live: (live: boolean) => {
      if (live) background()
    },
    reconnect: background,
  }
}

/**
 * Follow `target`'s log while the work item is shown; returns whether the follow is live, which is
 * when the caller's poll can stop. `null` follows nothing.
 */
export function useLogFollow(target: LogFollowTarget | null, reread: () => void): boolean {
  const visible = useWorkItemVisible()
  return useRealtimeFeed(logFollowFeed, visible ? target : null, logFollower(reread))
}
