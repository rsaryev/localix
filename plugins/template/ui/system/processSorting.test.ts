import { expect, test } from 'bun:test'
import type { ProcessRow } from '../../shared/processes'
import { defaultProcessSort, nextProcessSort, sortProcesses } from './processSorting'

const rows: ProcessRow[] = [
  { pid: 2, parentPid: 1, name: 'Worker 10', cpuPercent: null, memoryBytes: 300, memoryPercent: 3 },
  { pid: 3, parentPid: 1, name: 'worker 2', cpuPercent: 20, memoryBytes: 100, memoryPercent: 1 },
  { pid: 1, parentPid: 0, name: 'Alpha', cpuPercent: 5, memoryBytes: 200, memoryPercent: 2 },
]

test('sorts every process column with useful defaults', () => {
  expect(sortProcesses(rows, defaultProcessSort).map((row) => row.pid)).toEqual([3, 1, 2])
  expect(
    sortProcesses(rows, { key: 'memory', direction: 'descending' }).map((row) => row.pid),
  ).toEqual([2, 1, 3])
  expect(
    sortProcesses(rows, { key: 'name', direction: 'ascending' }).map((row) => row.pid),
  ).toEqual([1, 3, 2])
  expect(sortProcesses(rows, { key: 'pid', direction: 'ascending' }).map((row) => row.pid)).toEqual(
    [1, 2, 3],
  )
})

test('toggles the active column and gives new columns a natural direction', () => {
  expect(nextProcessSort(defaultProcessSort, 'cpu')).toEqual({
    key: 'cpu',
    direction: 'ascending',
  })
  expect(nextProcessSort(defaultProcessSort, 'name')).toEqual({
    key: 'name',
    direction: 'ascending',
  })
  expect(nextProcessSort(defaultProcessSort, 'memory')).toEqual({
    key: 'memory',
    direction: 'descending',
  })
})
