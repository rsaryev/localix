import { expect, test } from 'bun:test'
import { observeMutations } from './observe-mutations'

test('only successful selected mutations announce; callers retain results and types', async () => {
  const calls: string[] = []
  const service = {
    value: 0,
    async read(_userId: string) {
      return this.value
    },
    async write(_userId: string, value: number) {
      if (value < 0) throw new Error('refused')
      this.value = value
      calls.push('commit')
      return value
    },
  }
  observeMutations(service, { write: ['projects'] }, (userId, resources) => {
    calls.push(`${userId}:${resources.join(',')}`)
  })
  expect(await service.write('owner', 2)).toBe(2)
  expect(await service.read('owner')).toBe(2)
  await expect(service.write('owner', -1)).rejects.toThrow('refused')
  expect(calls).toEqual(['commit', 'owner:projects'])
})
