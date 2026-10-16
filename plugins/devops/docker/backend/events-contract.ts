/**
 * The Docker events live stream on the realtime socket (frame tag `k`).
 *
 * The workbench used to learn of a container that stopped, an image that was pulled or a volume
 * that was removed only by asking: containers every four seconds, everything else every 20, and
 * an open container tab every three — for as long as the panel stayed visible, whether or not the
 * daemon did anything. `docker events` says when something changed; the UI re-reads only then and
 * keeps a slow poll as the backstop for an event the stream could not deliver.
 *
 * A leaf with no runtime imports, so the browser bundle can take the constants.
 */
export const DOCKER_EVENTS_FRAME_TAG = 'k'
export const DOCKER_EVENTS_SUBSCRIBE = 'devops:docker.events.subscribe'
export const DOCKER_EVENTS_UNSUBSCRIBE = 'devops:docker.events.unsubscribe'

/** The object kinds the inventory shows; every other event type is not streamed. */
export type DockerEventType = 'container' | 'image' | 'volume' | 'network'

export type DockerEventsStatus = 'live' | 'down'

export type DockerEventsFrame =
  | { kind: 'event'; type: DockerEventType; action: string; id: string }
  | { kind: 'status'; status: DockerEventsStatus }
