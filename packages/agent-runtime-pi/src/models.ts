import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'

import type {
  RuntimeCredential,
  RuntimeCredentialInfo,
  RuntimeCredentialStore,
  RuntimeModelRef,
} from '@localixai/agent/runtime'

import { PiCredentialStoreAdapter, toPiCredential } from './auth'
import { createPiModelsCollection } from './providers'

class ScopedCredentialStore implements CredentialStore {
  private readonly providerId: string
  private credential: Credential

  constructor(providerId: string, credential: RuntimeCredential) {
    this.providerId = providerId
    this.credential = toPiCredential(credential)
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return providerId === this.providerId ? this.credential : undefined
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [{ providerId: this.providerId, type: this.credential.type }]
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    if (providerId !== this.providerId) return undefined
    const next = await fn(this.credential)
    if (next !== undefined) this.credential = next
    return this.credential
  }

  async delete(providerId: string): Promise<void> {
    if (providerId === this.providerId) {
      throw new Error('A run-scoped credential cannot be deleted')
    }
  }
}

class SnapshotFallbackCredentialStore implements RuntimeCredentialStore {
  constructor(
    private readonly providerId: string,
    private readonly snapshot: RuntimeCredential,
    private readonly durable: RuntimeCredentialStore,
  ) {}

  async read(providerId: string): Promise<RuntimeCredential | undefined> {
    return (
      (await this.durable.read(providerId)) ??
      (providerId === this.providerId ? this.snapshot : undefined)
    )
  }

  async list(): Promise<readonly RuntimeCredentialInfo[]> {
    const entries = new Map((await this.durable.list()).map((entry) => [entry.providerId, entry]))
    if (!entries.has(this.providerId)) {
      entries.set(this.providerId, {
        providerId: this.providerId,
        type: this.snapshot.type,
      })
    }
    return [...entries.values()]
  }

  modify(
    providerId: string,
    update: (current: RuntimeCredential | undefined) => Promise<RuntimeCredential | undefined>,
  ): Promise<RuntimeCredential | undefined> {
    return this.durable.modify(providerId, (current) =>
      update(current ?? (providerId === this.providerId ? this.snapshot : undefined)),
    )
  }

  delete(providerId: string): Promise<void> {
    return this.durable.delete(providerId)
  }
}

export function createPiCredentialStore(
  model: RuntimeModelRef,
  credential: RuntimeCredential,
  credentialStore?: RuntimeCredentialStore,
): CredentialStore {
  return credentialStore
    ? new PiCredentialStoreAdapter(
        new SnapshotFallbackCredentialStore(model.providerId, credential, credentialStore),
      )
    : new ScopedCredentialStore(model.providerId, credential)
}

export function createPiModels(
  model: RuntimeModelRef,
  credential: RuntimeCredential,
  credentialStore?: RuntimeCredentialStore,
) {
  const credentials = createPiCredentialStore(model, credential, credentialStore)
  // A run resolves exactly one model. Keep the credential-bound collection
  // request-scoped, but register only the provider that can own that model.
  return createPiModelsCollection({ credentials }, model.providerId)
}
