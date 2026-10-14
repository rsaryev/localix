import { describe, expect, it } from 'bun:test'
import { groupIndexRows } from './index-rows'

describe('groupIndexRows', () => {
  it('groups flat rows into indexes with columns in key order', () => {
    // Deliberately out of seq order to prove sorting.
    const out = groupIndexRows([
      { name: 'idx_ab', column: 'b', seq: 2, unique: true, constraint: true },
      { name: 'idx_ab', column: 'a', seq: 1, unique: true, constraint: true },
      { name: 'PRIMARY', column: 'id', seq: 1, unique: true, primary: true },
    ])
    const idxAb = out.find((i) => i.name === 'idx_ab')
    const pk = out.find((i) => i.name === 'PRIMARY')
    expect(idxAb).toMatchObject({
      columns: ['a', 'b'],
      unique: true,
      constraint: true,
    })
    expect(idxAb?.primary).toBeFalsy()
    expect(pk).toMatchObject({ columns: ['id'], unique: true, primary: true })
  })

  it('preserves first-seen index order and flags non-unique', () => {
    const out = groupIndexRows([
      { name: 'first', column: 'x', seq: 1, unique: false },
      { name: 'second', column: 'y', seq: 1, unique: false },
    ])
    expect(out.map((i) => i.name)).toEqual(['first', 'second'])
    expect(out.every((i) => !i.unique)).toBe(true)
  })

  it('keeps key directions, prefixes, included columns and clustered kind', () => {
    const [index] = groupIndexRows([
      {
        name: 'idx',
        column: 'b',
        seq: 2,
        unique: false,
        descending: true,
        prefixLength: 12,
        clustered: true,
      },
      {
        name: 'idx',
        column: 'a',
        seq: 1,
        unique: false,
        descending: false,
        prefixLength: null,
      },
      {
        name: 'idx',
        column: 'payload',
        seq: 3,
        unique: false,
        included: true,
      },
    ])
    expect(index).toMatchObject({
      columns: ['a', 'b'],
      orders: ['asc', 'desc'],
      prefixLengths: [null, 12],
      includeColumns: ['payload'],
      clustered: true,
    })
  })

  it('returns an empty array for no rows', () => {
    expect(groupIndexRows([])).toEqual([])
  })
})
