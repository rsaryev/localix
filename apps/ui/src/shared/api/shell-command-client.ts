import { client, unwrap } from './internal'
import type { ShellCommandStatusDto } from '@localixai/api/client'

/**
 * `localix` shell-command install ("install in PATH"). Lets the user
 * install a `localix` launcher into a user-writable bin dir so `localix .` /
 * `localix <path>` open in the running desktop app. See apps/api/features/shell-command.
 */
export const shellCommandApi = {
  async status(): Promise<ShellCommandStatusDto> {
    return unwrap(await client.rpc['shell-command'].$get())
  },
  async install(): Promise<ShellCommandStatusDto> {
    return unwrap(await client.rpc['shell-command'].install.$post())
  },
  async uninstall(): Promise<ShellCommandStatusDto> {
    return unwrap(await client.rpc['shell-command'].uninstall.$post())
  },
}

export type { ShellCommandStatusDto }
