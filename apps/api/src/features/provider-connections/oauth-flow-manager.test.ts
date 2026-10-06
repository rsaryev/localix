import { describe, expect, test } from 'bun:test'

import type {
  AgentRuntimeAuth,
  RuntimeCredential,
  RuntimeCredentialStore,
} from '@localixai/agent/runtime'

import { createOAuthFlowManager } from './oauth-flow-manager'

const credential: RuntimeCredential = {
  type: 'oauth',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 2_000_000_000_000,
}

function managerWith(auth: AgentRuntimeAuth) {
  return createOAuthFlowManager({
    createAuth: (_store: RuntimeCredentialStore) => auth,
    persist: async () => 'connection-1',
  })
}

describe('OAuth flow manager', () => {
  test('retry releases the abandoned listener before starting the next login', async () => {
    let listenerOccupied = false
    const signals: AbortSignal[] = []
    const persisted: string[] = []
    const manager = createOAuthFlowManager({
      createAuth: () => ({
        listProviders: () => [],
        logout: async () => {},
        async login(_providerId, _type, interaction) {
          if (listenerOccupied) throw new Error('callback port is in use')
          listenerOccupied = true
          signals.push(interaction.signal!)
          try {
            void interaction.notify({ type: 'auth-url', url: 'https://provider.example/login' })
            await interaction.prompt({ type: 'manual-code', message: 'Code' })
            return credential
          } finally {
            // Model asynchronous adapter cleanup before the port becomes available.
            await Promise.resolve()
            listenerOccupied = false
          }
        },
      }),
      persist: async ({ label }) => {
        persisted.push(label)
        return 'connection-retry'
      },
    })
    const input = {
      userId: 'user-1',
      providerId: 'openai',
      providerName: 'OpenAI',
      label: 'Abandoned',
    }
    try {
      const first = await manager.begin(input)
      const retry = await manager.begin({ ...input, label: 'Retry' })
      expect(retry.redirectUrl).toBe('https://provider.example/login')
      expect(retry.state).not.toBe(first.state)
      expect(signals).toHaveLength(2)
      expect(signals[0]!.aborted).toBe(true)
      expect(signals[1]!.aborted).toBe(false)
      await expect(manager.complete('user-1', first.state, 'old-code')).rejects.toThrow(
        'oauth_state_not_found',
      )
      expect(await manager.complete('user-1', retry.state, 'new-code')).toBe('connection-retry')
      expect(persisted).toEqual(['Retry'])
    } finally {
      manager.dispose()
    }
  })

  test('retry keeps other users and providers active and rejects late cancelled credentials', async () => {
    const signals: AbortSignal[] = []
    const persisted: string[] = []
    const manager = createOAuthFlowManager({
      createAuth: () => ({
        listProviders: () => [],
        logout: async () => {},
        async login(_providerId, _type, interaction) {
          signals.push(interaction.signal!)
          void interaction.notify({ type: 'auth-url', url: 'https://provider.example/login' })
          // Some adapters may return a credential despite cancellation.
          await interaction.prompt({ type: 'manual-code', message: 'Code' }).catch(() => {})
          return credential
        },
      }),
      persist: async ({ label }) => {
        persisted.push(label)
        return 'connection-1'
      },
    })
    const input = {
      userId: 'user-1',
      providerId: 'openai',
      providerName: 'OpenAI',
      label: 'Abandoned',
    }
    try {
      await manager.begin(input)
      await manager.begin({ ...input, userId: 'user-2' })
      await manager.begin({ ...input, providerId: 'anthropic' })
      const retry = await manager.begin({ ...input, label: 'Retry' })
      expect(signals.map((signal) => signal.aborted)).toEqual([true, false, false, false])
      expect(persisted).toEqual([])
      await manager.complete('user-1', retry.state, 'code')
      expect(persisted).toEqual(['Retry'])
    } finally {
      manager.dispose()
    }
  })

  test('answers the default select prompt and waits for auth_url before returning', async () => {
    let selected: string | undefined
    const manager = managerWith({
      listProviders: () => [],
      logout: async () => {},
      async login(_providerId, _type, interaction) {
        selected = await interaction.prompt({
          type: 'select',
          message: 'Login method',
          options: [
            { id: 'browser', label: 'Browser' },
            { id: 'device', label: 'Device' },
          ],
        })
        void interaction.notify({ type: 'auth-url', url: 'https://provider.example/login' })
        const code = await interaction.prompt({ type: 'manual-code', message: 'Code' })
        expect(code).toBe('oauth-code')
        return credential
      },
    })

    const started = await manager.begin({
      userId: 'user-1',
      providerId: 'provider-1',
      providerName: 'Provider',
      label: 'Personal',
    })
    expect(selected).toBe('browser')
    expect(started).toMatchObject({
      mode: 'local-server',
      redirectUrl: 'https://provider.example/login',
    })
    expect(manager.complete('user-1', started.state, 'oauth-code')).resolves.toBe('connection-1')
  })

  test('uses a blank optional text answer before a device-code flow', async () => {
    let answer: string | undefined
    const manager = managerWith({
      listProviders: () => [],
      logout: async () => {},
      async login(_providerId, _type, interaction) {
        answer = await interaction.prompt({ type: 'text', message: 'Enterprise domain' })
        void interaction.notify({
          type: 'device-code',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://provider.example/device',
        })
        return credential
      },
    })

    const started = await manager.begin({
      userId: 'user-1',
      providerId: 'provider-1',
      providerName: 'Provider',
      label: 'Personal',
    })
    expect(answer).toBe('')
    expect(started).toMatchObject({ mode: 'device-code', userCode: 'ABCD-EFGH' })
  })

  test('propagates an adapter login failure to the initiate request', async () => {
    const manager = managerWith({
      listProviders: () => [],
      logout: async () => {},
      async login() {
        throw new Error('provider rejected login')
      },
    })

    expect(
      manager.begin({
        userId: 'user-1',
        providerId: 'provider-1',
        providerName: 'Provider',
        label: 'Personal',
      }),
    ).rejects.toThrow('provider rejected login')
  })

  test('dispose aborts pending flows and rejects future admission', async () => {
    let loginSignal: AbortSignal | undefined
    const manager = managerWith({
      listProviders: () => [],
      logout: async () => {},
      async login(_providerId, _type, interaction) {
        loginSignal = interaction.signal
        void interaction.notify({ type: 'auth-url', url: 'https://provider.example/login' })
        await interaction.prompt({ type: 'manual-code', message: 'Code' })
        return credential
      },
    })

    const started = await manager.begin({
      userId: 'user-1',
      providerId: 'provider-1',
      providerName: 'Provider',
      label: 'Personal',
    })

    manager.dispose()
    manager.dispose()

    expect(loginSignal?.aborted).toBe(true)
    expect(manager.complete('user-1', started.state, 'oauth-code')).rejects.toThrow(
      'oauth_state_not_found',
    )
    expect(
      manager.begin({
        userId: 'user-1',
        providerId: 'provider-1',
        providerName: 'Provider',
        label: 'Personal',
      }),
    ).rejects.toThrow('OAuth flow manager is shut down')
  })
})
