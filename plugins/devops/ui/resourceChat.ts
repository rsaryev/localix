import { resourceMessageBindingDraft } from '@localixai/plugin-sdk/ui'

import { pluginComposer } from '@localixai/plugin-sdk/ui/runtime'

export interface DevOpsResourceLink {
  uri: string
  label: string
}

/**
 * Stage one live DevOps resource in the normal chat composer.
 *
 * The existing localix://resource/docker / localix://resource/k8s resource providers resolve the linked resource
 * for the main agent at send time. The link carries context, not intent: adding a
 * resource must never invent a review/troubleshooting prompt on the user's behalf.
 *
 * `sessionId` names the chat whose composer receives it — the surface's own. Without it the
 * insert went to whichever composer had focus, another chat's when the surface was a background
 * one.
 */
export function linkDevOpsResourceToChat(sessionId: string, resource: DevOpsResourceLink): void {
  pluginComposer.insert({
    sessionId,
    bindings: [resourceMessageBindingDraft(resource)],
  })
}
