import { useEffect, useState } from 'react'

/**
 * Load what a reference points at, again whenever `key` changes (the path, or the file's stamp),
 * and never let an older answer overwrite a newer one: a card whose file was renamed twice in a
 * second shows the last name's content, not whichever request came back last.
 */
export function useFetched<T>(key: string, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: '' })
  useEffect(() => {
    let current = true
    load().then(
      (data) => current && setState({ key, data }),
      (error: unknown) =>
        current && setState({ key, error: error instanceof Error ? error.message : String(error) }),
    )
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names everything `load` reads
  }, [key])
  return { data: state.data, error: state.error, loading: state.key !== key }
}
