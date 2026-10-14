import type { HumanInLoopRequestBase, HumanInLoopResponseBase } from '@localixai/agent/agents'
import type { VaultItemType } from '../../../secrets/contracts'

// The `request_secret` HITL CONTRACT — the REQUEST leg of the credential hand-off.
//
// There is deliberately no `request_secret` tool: the unified `vault` tool
// (features/secrets/agent-tool.ts) owns every credential action and raises this
// envelope from its create/rotate paths. What lives here is only the wire contract
// shared by that producer, the answer leg (chatService.submitSecret), and the chat
// surface that renders the masked input — hence a types-only module.
//
// The typed VALUE never travels through it: it rides a dedicated `submit-secret` WS
// command into the encrypted vault, and the paused request resolves with ONLY
// `{ stored }`. So nothing declared here may ever carry a secret value; the model
// sees just the key and a boolean.

/** The value-free request shown to the user — key + reason only, BY DESIGN. */
export interface RequestSecretPayload {
  action: 'create' | 'rotate'
  key: string
  reason: string
  type: VaultItemType
  label?: string
  description?: string
  tags: string[]
  expectedVersion?: number
}

export type RequestSecretRequest = HumanInLoopRequestBase<'request_secret', RequestSecretPayload>

/** What the run resumes with: a boolean, never the value. */
export interface RequestSecretResponsePayload {
  answers: {
    stored: boolean
    outcome?: 'created' | 'rotated' | 'exists' | 'missing' | 'conflict'
  }
}

export type RequestSecretResponse = HumanInLoopResponseBase<
  'request_secret',
  RequestSecretResponsePayload
>
