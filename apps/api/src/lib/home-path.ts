import { join } from 'node:path'

/** `~` or `~/…`: a path a shell would have expanded to the home directory. */
export const isHomePath = (path: string): boolean => path === '~' || path.startsWith('~/')

/** `~` and `~/…` made absolute under `home`; any other path comes back unchanged. */
export const expandHome = (path: string, home: string): string =>
  isHomePath(path) ? join(home, path.slice(1)) : path
