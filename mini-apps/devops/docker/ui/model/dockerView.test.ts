import { describe, expect, test } from 'bun:test'

import { normalizeDockerView } from './dockerView'

describe('Docker view persistence', () => {
  test('keeps a valid resource, filter, and per-resource sort', () => {
    const view = normalizeDockerView({
      resource: 'volumes',
      filter: 'cache',
      sort: { volumes: { key: 'driver', direction: 'desc' } },
    })
    expect(view).toMatchObject({ resource: 'volumes', filter: 'cache' })
    expect(view.sort.volumes).toEqual({ key: 'driver', direction: 'desc' })
    expect(view.sort.images).toEqual({ key: 'name', direction: 'asc' })
  })

  test('drops corrupt values', () => {
    const view = normalizeDockerView({
      resource: 'pods',
      filter: 4,
      sort: { containers: { key: 'driver', direction: 'sideways' } },
    })
    expect(view).toMatchObject({
      resource: 'containers',
      filter: '',
    })
    expect(view.sort.containers).toEqual({ key: 'name', direction: 'asc' })
  })
})
