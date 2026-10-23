import { describe, expect, test } from 'bun:test'
import type { DockerContainer } from '../../backend/contracts'
import {
  aggregateState,
  filterContainers,
  groupContainers,
  isActive,
  stateDotClass,
} from './groupContainers'

const c = (over: Partial<DockerContainer>): DockerContainer => ({
  id: 'x',
  name: 'x',
  image: 'img',
  state: 'running',
  status: '',
  ports: '',
  createdAt: '',
  ...over,
})

describe('groupContainers', () => {
  test('splits running/restarting from the rest, running first', () => {
    const groups = groupContainers([
      c({ id: 'a', state: 'running' }),
      c({ id: 'b', state: 'exited' }),
      c({ id: 'r', state: 'restarting' }),
      c({ id: 'p', state: 'paused' }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['running', 'stopped'])
    expect(groups[0]?.containers.map((x) => x.id)).toEqual(['a', 'r'])
    expect(groups[1]?.containers.map((x) => x.id)).toEqual(['b', 'p'])
  })

  test('omits an empty group', () => {
    expect(groupContainers([c({ state: 'running' })]).map((g) => g.key)).toEqual(['running'])
    expect(groupContainers([]).length).toBe(0)
  })

  test('groups compose containers by project (alphabetical), then state groups', () => {
    const groups = groupContainers([
      c({ id: 'w', state: 'running', project: 'shop', service: 'web' }),
      c({ id: 'plain', state: 'running' }),
      c({ id: 'd', state: 'exited', project: 'shop', service: 'db' }),
      c({ id: 'api', state: 'running', project: 'auth', service: 'api' }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['project:auth', 'project:shop', 'running'])
    // project members sorted by service name (db before web).
    const shop = groups.find((g) => g.key === 'project:shop')
    expect(shop?.kind).toBe('project')
    expect(shop?.containers.map((x) => x.id)).toEqual(['d', 'w'])
    expect(shop?.state).toBe('running') // aggregate: one member is up
    // ungrouped container falls into the running state group.
    expect(groups.find((g) => g.key === 'running')?.containers.map((x) => x.id)).toEqual(['plain'])
  })
})

describe('aggregateState', () => {
  test('picks the most-alive member state', () => {
    expect(aggregateState([c({ state: 'exited' }), c({ state: 'running' })])).toBe('running')
    expect(aggregateState([c({ state: 'exited' }), c({ state: 'paused' })])).toBe('paused')
    expect(aggregateState([c({ state: 'exited' }), c({ state: 'dead' })])).toBe('exited')
  })
})

describe('isActive', () => {
  test('running + restarting are active', () => {
    expect(isActive('running')).toBe(true)
    expect(isActive('restarting')).toBe(true)
    expect(isActive('exited')).toBe(false)
    expect(isActive('paused')).toBe(false)
  })
})

describe('filterContainers', () => {
  test('matches name or image case-insensitively', () => {
    const list = [
      c({ id: '1', name: 'postgres-db', image: 'postgres:16' }),
      c({ id: '2', name: 'web', image: 'nginx' }),
    ]
    expect(filterContainers(list, 'PG').length).toBe(0)
    expect(filterContainers(list, 'postgres').map((x) => x.id)).toEqual(['1'])
    expect(filterContainers(list, 'nginx').map((x) => x.id)).toEqual(['2'])
    expect(filterContainers(list, '').length).toBe(2)
  })

  test('also matches compose project and service names', () => {
    const list = [c({ id: '1', name: 'x', image: 'y', project: 'shop', service: 'checkout' })]
    expect(filterContainers(list, 'shop').map((x) => x.id)).toEqual(['1'])
    expect(filterContainers(list, 'checkout').map((x) => x.id)).toEqual(['1'])
    expect(filterContainers(list, 'nope').length).toBe(0)
  })
})

describe('stateDotClass', () => {
  test('maps state to a status token', () => {
    expect(stateDotClass('running')).toContain('status-success')
    expect(stateDotClass('exited')).toContain('status-error')
    expect(stateDotClass('paused')).toContain('status-warning')
  })
})
