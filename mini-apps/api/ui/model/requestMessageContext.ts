import {
  resourceMessageBindingDraft,
  snippetMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'

import type { SendResponse } from '../../backend/contracts'
import { buildRequestUri } from '../../backend/uri'
import { buildResponseContext } from './responseMessageContext'

/** Native ambient context for the request currently visible in the workbench. */
export function buildRequestMessageContext(
  name: string,
  response: SendResponse | null,
): PublishedMessageContext {
  const bindings: Array<ReturnType<typeof resourceMessageBindingDraft>> = [
    resourceMessageBindingDraft({ uri: buildRequestUri(name), label: name }),
  ]
  if (response) {
    const { snippet, language } = buildResponseContext({ response })
    bindings.push(
      snippetMessageBindingDraft({ label: `${name} response`, content: snippet, language }),
    )
  }
  return { strategy: 'append', bindings }
}
