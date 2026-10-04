import type { ProcessRow } from '../../shared/processes'

export type ProcessSortKey = 'name' | 'pid' | 'cpu' | 'memory'
export type SortDirection = 'ascending' | 'descending'
export interface ProcessSort {
  key: ProcessSortKey
  direction: SortDirection
}

export const defaultProcessSort: ProcessSort = { key: 'cpu', direction: 'descending' }

export function nextProcessSort(current: ProcessSort, key: ProcessSortKey): ProcessSort {
  if (current.key === key) {
    return {
      key,
      direction: current.direction === 'ascending' ? 'descending' : 'ascending',
    }
  }
  return {
    key,
    direction: key === 'name' || key === 'pid' ? 'ascending' : 'descending',
  }
}

export function sortProcesses(rows: ProcessRow[], sort: ProcessSort): ProcessRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const compared = compareRows(left.row, right.row, sort)
      return compared || left.index - right.index
    })
    .map(({ row }) => row)
}

function compareRows(left: ProcessRow, right: ProcessRow, sort: ProcessSort): number {
  if (sort.key === 'cpu' && (left.cpuPercent === null || right.cpuPercent === null)) {
    if (left.cpuPercent === right.cpuPercent) return left.pid - right.pid
    return left.cpuPercent === null ? 1 : -1
  }
  const compared =
    sort.key === 'name'
      ? left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
      : sort.key === 'pid'
        ? left.pid - right.pid
        : sort.key === 'cpu'
          ? (left.cpuPercent ?? 0) - (right.cpuPercent ?? 0)
          : left.memoryBytes - right.memoryBytes
  return sort.direction === 'ascending' ? compared : -compared
}
