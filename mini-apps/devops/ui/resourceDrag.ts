import { resourceMessageBindingDraft } from '@localixai/mini-app-sdk/ui'

import { setMessageBindingDrag } from '@localixai/mini-app-sdk/ui/message-binding-drag'

export interface DevOpsResourceLink {
  uri: string
  label: string
}

/**
 * Write the complete native drag payload expected by the main composer.
 *
 * The custom MIME carries the structured binding; the opted-in text/plain keeps
 * the gesture viable in WebKit/WebView implementations and provides a useful
 * fallback if the resource is dropped outside Localix.
 */
export function setDevOpsResourceDrag(
  dataTransfer: DataTransfer,
  resource: DevOpsResourceLink,
): void {
  const binding = resourceMessageBindingDraft(resource, 'drag')
  setMessageBindingDrag(dataTransfer, binding, { plainText: binding.target.token })
}
