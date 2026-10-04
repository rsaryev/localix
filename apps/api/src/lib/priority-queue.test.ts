import { describe, expect, test } from 'bun:test'

import { createPriorityQueue } from './priority-queue'

describe('createPriorityQueue', () => {
  test('reprioritizing and updating preserve original FIFO age', () => {
    const queue = createPriorityQueue<string>()
    queue.enqueue('old', { id: 'a', priority: 10 })
    queue.enqueue('new', { id: 'b', priority: 0 })
    expect(queue.setPriority('a', 0)).toBe(true)
    expect(queue.update('a', 'updated')).toBe(true)
    expect(queue.take()).toEqual({ id: 'a', priority: 0, value: 'updated' })
    expect(queue.take()?.id).toBe('b')
    expect(queue.take()).toBeUndefined()
    expect(queue.setPriority('missing', 0)).toBe(false)
    expect(queue.update('missing', 'value')).toBe(false)
  })

  test('rejects duplicate ids and non-finite priorities without corrupting pending work', () => {
    const queue = createPriorityQueue<string>()
    queue.enqueue('first', { id: 'q1' })
    expect(queue.enqueue('second').id).not.toBe('q1')
    expect(() => queue.enqueue('duplicate', { id: 'q1' })).toThrow('Duplicate')
    expect(() => queue.setPriority('q1', Number.NaN)).toThrow('Invalid')
    expect(() => queue.enqueue('bad', { priority: Infinity })).toThrow('Invalid')
    expect(queue.size()).toBe(2)
  })
  test('FIFO within a single priority band', () => {
    const q = createPriorityQueue<string>()
    q.enqueue('a')
    q.enqueue('b')
    q.enqueue('c')
    expect(q.takeTopBand().map((i) => i.value)).toEqual(['a', 'b', 'c'])
    expect(q.size()).toBe(0)
  })

  test('lower priority number drains first; one band per take', () => {
    const q = createPriorityQueue<string>()
    q.enqueue('wake1', { priority: 10 })
    q.enqueue('user1', { priority: 0 })
    q.enqueue('wake2', { priority: 10 })
    q.enqueue('user2', { priority: 0 })
    // First take = the whole priority-0 band, FIFO.
    expect(q.takeTopBand().map((i) => i.value)).toEqual(['user1', 'user2'])
    // Next take = the next band.
    expect(q.takeTopBand().map((i) => i.value)).toEqual(['wake1', 'wake2'])
    expect(q.takeTopBand()).toEqual([])
  })

  test('remove by id; ids are unique across re-adds', () => {
    const q = createPriorityQueue<string>()
    const a = q.enqueue('a')
    const b = q.enqueue('b')
    expect(q.remove(a.id)).toBe(true)
    expect(q.remove(a.id)).toBe(false)
    const c = q.enqueue('c')
    expect(a.id).not.toBe(c.id)
    expect(q.list().map((i) => i.value)).toEqual(['b', 'c'])
    expect(b.id).not.toBe(c.id)
  })

  test('list is sorted priority then FIFO; peek matches', () => {
    const q = createPriorityQueue<string>()
    q.enqueue('late', { priority: 10 })
    q.enqueue('first', { priority: 0 })
    q.enqueue('second', { priority: 0 })
    expect(q.list().map((i) => i.value)).toEqual(['first', 'second', 'late'])
    expect(q.peek()?.value).toBe('first')
  })

  test('clear empties the queue', () => {
    const q = createPriorityQueue<number>()
    q.enqueue(1)
    q.enqueue(2)
    q.clear()
    expect(q.size()).toBe(0)
    expect(q.peek()).toBeUndefined()
  })

  // Rebuild-from-persisted-state path (/loop + durable wake queue): items are
  // re-enqueued with their stored id + priority, then addressed by that id.
  test('honors an explicit id + priority and is removable by that id', () => {
    const q = createPriorityQueue<string>()
    const a = q.enqueue('first', { id: 'task-1', priority: 5 })
    const b = q.enqueue('second', { id: 'task-2', priority: 1 })
    expect(a.id).toBe('task-1')
    expect(a.priority).toBe(5)
    // priority 1 drains before priority 5, regardless of insertion order
    expect(q.peek()?.id).toBe('task-2')
    expect(q.remove('task-2')).toBe(true)
    expect(q.peek()?.id).toBe('task-1')
    expect(q.remove('task-2')).toBe(false) // already gone
    expect(b.value).toBe('second')
  })

  test('a rebuilt queue lists items in drain order by stored id', () => {
    const q = createPriorityQueue<string>()
    q.enqueue('low', { id: 'x', priority: 10 })
    q.enqueue('high', { id: 'y', priority: 1 })
    q.enqueue('mid', { id: 'z', priority: 5 })
    expect(q.list().map((i) => i.id)).toEqual(['y', 'z', 'x'])
  })
})
