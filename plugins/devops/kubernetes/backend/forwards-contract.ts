/**
 * The port-forward change stream on the realtime socket (frame tag `f`).
 *
 * Forwards are this process's own sockets, not cluster objects, so the pod watch never carried
 * them: a pod tab re-read the forward list every five seconds while it had one, only to notice a
 * tunnel the cluster closed. The registry announces every start, stop and death instead, and the
 * UI re-reads the list on that frame; the poll is left for while the stream is down.
 *
 * A leaf with no runtime imports, so the browser bundle can take the constants.
 */
export const PORT_FORWARDS_FRAME_TAG = 'f'
export const PORT_FORWARDS_SUBSCRIBE = 'devops:k8s.forwards.subscribe'
export const PORT_FORWARDS_UNSUBSCRIBE = 'devops:k8s.forwards.unsubscribe'

/** The forward list changed; the frame carries no list, the reader asks for it. */
export type PortForwardsFrame = { kind: 'changed' }
