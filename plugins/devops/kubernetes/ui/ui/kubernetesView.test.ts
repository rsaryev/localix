import { describe, expect, test } from 'bun:test'
import { normalizeK8sView } from '../model/viewState'

describe('normalizeK8sView', () => {
  test('defaults an empty/missing record', () => {
    for (const raw of [null, undefined, 'nonsense']) {
      const view = normalizeK8sView(raw)
      expect(view).toMatchObject({ filter: '', resource: 'workloads' })
      expect(view.sort.workloads).toEqual({ key: 'name', direction: 'asc' })
      expect(view.sort.pods).toEqual({ key: 'status', direction: 'asc' })
    }
  })

  test('keeps a valid record and per-resource sort', () => {
    const view = normalizeK8sView({
      filter: 'api',
      resource: 'nodes',
      sort: { nodes: { key: 'role', direction: 'desc' } },
    })
    expect(view).toMatchObject({ filter: 'api', resource: 'nodes' })
    expect(view.sort.nodes).toEqual({ key: 'role', direction: 'desc' })
  })

  test('drops a non-string filter and invalid resource', () => {
    const view = normalizeK8sView({
      filter: 42,
      resource: 'secrets',
      sort: { pods: { key: 'role', direction: 'sideways' } },
    })
    expect(view).toMatchObject({
      filter: '',
      resource: 'workloads',
    })
    expect(view.sort.pods).toEqual({ key: 'status', direction: 'asc' })
  })

  test('migrates the old collapsible-sections record to workloads', () => {
    expect(normalizeK8sView({ filter: 'x', sections: { Nodes: true } })).toMatchObject({
      filter: 'x',
      resource: 'workloads',
    })
  })
})
