import { randomBytes } from 'node:crypto'

import type {
  AgentRuntimeAuth,
  RuntimeAuthEvent,
  RuntimeAuthPrompt,
  RuntimeCredential,
  RuntimeCredentialInfo,
  RuntimeCredentialStore,
} from '@localixai/agent/runtime'

const FLOW_TTL_MS = 15 * 60 * 1000
const INITIAL_EVENT_TIMEOUT_MS = 30 * 1000

class FlowCredentialStore implements RuntimeCredentialStore {
  private credential: RuntimeCredential | undefined
  private readonly providerId: string

  constructor(providerId: string) {
    this.providerId = providerId
  }

  async read(providerId: string): Promise<RuntimeCredential | undefined> {
    return providerId === this.providerId ? this.credential : undefined
  }

  async list(): Promise<readonly RuntimeCredentialInfo[]> {
    return this.credential ? [{ providerId: this.providerId, type: this.credential.type }] : []
  }

  async modify(
    providerId: string,
    update: (current: RuntimeCredential | undefined) => Promise<RuntimeCredential | undefined>,
  ): Promise<RuntimeCredential | undefined> {
    if (providerId !== this.providerId) return undefined
    const next = await update(this.credential)
    if (next !== undefined) this.credential = next
    return this.credential
  }

  async delete(providerId: string): Promise<void> {
    if (providerId === this.providerId) this.credential = undefined
  }
}

interface PendingPrompt {
  resolve(value: string): void
  reject(error: Error): void
}

interface OAuthFlow {
  state: string
  userId: string
  providerId: string
  expiresAt: number
  prompt?: PendingPrompt
  initial: Promise<InitiateOAuthResponse>
  resolveInitial(value: InitiateOAuthResponse): void
  rejectInitial(error: Error): void
  completion: Promise<string>
  controller: AbortController
  expiryTimer?: ReturnType<typeof setTimeout>
}

export interface OAuthFlowManagerDeps {
  createAuth(store: RuntimeCredentialStore): AgentRuntimeAuth
  persist(input: {
    userId: string
    providerId: string
    providerName: string
    label: string
    credential: RuntimeCredential
  }): Promise<string>
}

export type InitiateOAuthResponse = {
  state: string
  mode: 'app-redirect' | 'local-server' | 'device-code'
  redirectUrl?: string
  userCode?: string
  verificationUri?: string
  expiresInSeconds?: number
  intervalSeconds?: number
}

export function createOAuthFlowManager(deps: OAuthFlowManagerDeps) {
  const flows = new Map<string, OAuthFlow>()
  let closed = false

  const sweep = () => {
    const now = Date.now()
    for (const [state, flow] of flows) {
      if (flow.expiresAt <= now) {
        flow.controller.abort()
        flow.prompt?.reject(new Error('OAuth flow expired'))
        flow.rejectInitial(new Error('OAuth flow expired'))
        flows.delete(state)
      }
    }
  }

  const toInitial = (state: string, event: RuntimeAuthEvent): InitiateOAuthResponse | null => {
    if (event.type === 'auth-url') {
      // Native pi browser flows own their fixed loopback listener and complete
      // inside the API process. The host opens the URL and polls for the new
      // connection; it must not navigate the SPA or pretend its callbackUrl is used.
      return { state, mode: 'local-server', redirectUrl: event.url }
    }
    if (event.type === 'device-code') {
      return {
        state,
        mode: 'device-code',
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        expiresInSeconds: event.expiresInSeconds,
        intervalSeconds: event.intervalSeconds,
      }
    }
    return null
  }

  return {
    async begin(input: {
      userId: string
      providerId: string
      providerName: string
      label: string
    }): Promise<InitiateOAuthResponse> {
      if (closed) throw new Error('OAuth flow manager is shut down')
      sweep()
      // Closing the browser does not end the adapter's loopback listener. A retry
      // must wait for the previous login's cleanup before it can bind that port.
      let previous: OAuthFlow | undefined
      while (
        (previous = [...flows.values()].find(
          (flow) => flow.userId === input.userId && flow.providerId === input.providerId,
        ))
      ) {
        const error = new Error('OAuth flow superseded by a new sign-in attempt')
        previous.controller.abort(error)
        previous.prompt?.reject(error)
        previous.rejectInitial(error)
        await previous.completion.catch(() => {})
        if (closed) throw new Error('OAuth flow manager is shut down')
      }
      const state = randomBytes(20).toString('hex')
      let initialSettled = false
      let resolveInitial!: (value: InitiateOAuthResponse) => void
      let rejectInitial!: (error: Error) => void
      let initialTimer: ReturnType<typeof setTimeout> | undefined
      const initial = new Promise<InitiateOAuthResponse>((resolve, reject) => {
        resolveInitial = (value) => {
          if (initialSettled) return
          initialSettled = true
          if (initialTimer) clearTimeout(initialTimer)
          resolve(value)
        }
        rejectInitial = (error) => {
          if (initialSettled) return
          initialSettled = true
          if (initialTimer) clearTimeout(initialTimer)
          reject(error)
        }
      })
      const store = new FlowCredentialStore(input.providerId)
      const auth = deps.createAuth(store)
      const controller = new AbortController()
      const flow: OAuthFlow = {
        state,
        userId: input.userId,
        providerId: input.providerId,
        expiresAt: Date.now() + FLOW_TTL_MS,
        initial,
        resolveInitial,
        rejectInitial,
        completion: Promise.resolve(''),
        controller,
      }
      const prompt = (request: RuntimeAuthPrompt): Promise<string> => {
        // Built-in OAuth adapters may ask for a login mode or an optional
        // enterprise domain before emitting their auth URL/device code. Choose
        // the advertised default so the HTTP flow never stalls on a prompt the
        // current UI cannot render.
        if (request.type === 'select') {
          const first = request.options[0]
          return first
            ? Promise.resolve(first.id)
            : Promise.reject(new Error('OAuth provider offered no login methods'))
        }
        if (request.type === 'text') return Promise.resolve('')
        if (request.type === 'secret') {
          return Promise.reject(new Error('OAuth provider requested an unsupported secret prompt'))
        }

        // auth_url is delivered through notify(). Pi queues that notification
        // just before asking for manual_code, so resolving the initial HTTP call
        // here races it and produces an interactive response with no URL — the
        // observed "OAuth button does nothing" failure. Only the event resolves
        // the initial response; this promise waits for the callback code.
        return new Promise<string>((resolve, reject) => {
          flow.prompt = { resolve, reject }
          request.signal?.addEventListener(
            'abort',
            () => reject(new Error('OAuth prompt cancelled')),
            { once: true },
          )
        })
      }
      const completion = auth
        .login(input.providerId, 'oauth', {
          signal: controller.signal,
          prompt,
          notify(event) {
            const result = toInitial(state, event)
            if (result) resolveInitial(result)
          },
        })
        .then(async (credential) => {
          controller.signal.throwIfAborted()
          const connectionId = await deps.persist({ ...input, credential })
          resolveInitial({ state, mode: 'local-server' })
          return connectionId
        })
        .catch((error: unknown) => {
          const normalized = error instanceof Error ? error : new Error(String(error))
          rejectInitial(normalized)
          throw normalized
        })
        .finally(() => {
          if (flow.expiryTimer) clearTimeout(flow.expiryTimer)
          flows.delete(state)
        })
      flow.completion = completion
      flows.set(state, flow)
      flow.expiryTimer = setTimeout(() => {
        const error = new Error('OAuth flow expired')
        controller.abort()
        flow.prompt?.reject(error)
        rejectInitial(error)
        flows.delete(state)
      }, FLOW_TTL_MS)
      flow.expiryTimer.unref?.()
      initialTimer = setTimeout(() => {
        const error = new Error('OAuth provider did not start an interactive flow')
        controller.abort()
        flow.prompt?.reject(error)
        rejectInitial(error)
        flows.delete(state)
      }, INITIAL_EVENT_TIMEOUT_MS)
      initialTimer.unref?.()
      void completion.catch(() => {})
      return initial
    },

    async complete(userId: string, state: string, code: string): Promise<string> {
      sweep()
      const flow = flows.get(state)
      if (!flow) throw new Error('oauth_state_not_found')
      if (flow.userId !== userId) throw new Error('oauth_state_user_mismatch')
      if (!flow.prompt) throw new Error('oauth_code_not_requested')
      const prompt = flow.prompt
      flow.prompt = undefined
      prompt.resolve(code)
      return flow.completion
    },

    /** Abort every pending provider login and release its deadline timers. */
    dispose(): void {
      if (closed) return
      closed = true
      const error = new Error('OAuth flow manager is shut down')
      for (const [state, flow] of flows) {
        if (flow.expiryTimer) clearTimeout(flow.expiryTimer)
        flow.controller.abort(error)
        flow.prompt?.reject(error)
        flow.rejectInitial(error)
        flows.delete(state)
      }
    },
  }
}
