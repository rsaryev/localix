import { useState } from 'react'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'
import { BALANCE_STOPS, DEFAULT_BALANCE } from './recommendRanking'

const KEY = 'localix.localModels.balance'

function read(): number {
  const raw = loadString(KEY)
  const stored = raw === null ? Number.NaN : Number(raw)
  return Number.isInteger(stored) && stored >= 0 && stored < BALANCE_STOPS.length
    ? stored
    : DEFAULT_BALANCE
}

/**
 * The speed-or-quality stop the recommended models are ranked for. A per-viewer convenience:
 * kept in this browser, and Balanced whenever it cannot be read.
 */
export function useBalance(): [number, (index: number) => void] {
  const [balance, setBalance] = useState(read)
  return [
    balance,
    (index) => {
      setBalance(index)
      saveString(KEY, String(index))
    },
  ]
}
