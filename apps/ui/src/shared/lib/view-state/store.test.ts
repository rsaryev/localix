import { expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { viewStateStore } from './store'

test('an edit made while saving is retained and saved against the next revision', async () => {
  const address = { kind: 'draft' as const, key: 'draft-flight' }
  const read = spyOn(backendClient, 'getViewState').mockResolvedValue({
    ...address,
    revision: 0,
    value: null,
    updatedAt: null,
  })
  let resolve!: (value: unknown) => void
  const write = spyOn(backendClient, 'writeViewState')
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }) as never,
    )
    .mockImplementation(async (input) => ({
      accepted: true,
      state: {
        ...address,
        revision: input.expectedRevision + 1,
        value: input.value,
        updatedAt: null,
      },
    }))
  try {
    await viewStateStore.ready(address)
    viewStateStore.set(address, { text: 'First' })
    const flight = viewStateStore.flush(address)
    await Promise.resolve()
    viewStateStore.set(address, { text: 'Latest' })
    resolve({
      accepted: true,
      state: { ...address, revision: 1, value: { text: 'First' }, updatedAt: null },
    })
    await flight
    expect(viewStateStore.snapshot(address).value).toEqual({ text: 'Latest' })
    await viewStateStore.flush(address)
    expect(write).toHaveBeenLastCalledWith({
      ...address,
      expectedRevision: 1,
      value: { text: 'Latest' },
    })
    expect(viewStateStore.snapshot(address)).toMatchObject({ revision: 2, pending: false })
  } finally {
    read.mockRestore()
    write.mockRestore()
  }
})

test('a conflicting channel draft stays visible until the user chooses which text to keep', async () => {
  const address = { kind: 'draft' as const, key: 'draft-conflict' }
  const read = spyOn(backendClient, 'getViewState').mockResolvedValue({
    ...address,
    revision: 1,
    value: { text: 'Shared' },
    updatedAt: null,
  })
  const write = spyOn(backendClient, 'writeViewState').mockResolvedValue({
    accepted: false,
    state: { ...address, revision: 2, value: { text: 'Other channel' }, updatedAt: null },
  })
  try {
    await viewStateStore.ready(address)
    viewStateStore.set(address, { text: 'My edit' })
    await viewStateStore.flush(address)
    expect(viewStateStore.snapshot(address).value).toEqual({ text: 'My edit' })
    expect(viewStateStore.snapshot(address).conflict?.value).toEqual({ text: 'Other channel' })
    await viewStateStore.flush(address)
    expect(write).toHaveBeenCalledTimes(1)
    viewStateStore.acceptRemote(address)
    expect(viewStateStore.snapshot(address)).toMatchObject({
      revision: 2,
      value: { text: 'Other channel' },
      conflict: null,
      pending: false,
    })
  } finally {
    read.mockRestore()
    write.mockRestore()
  }
})
