/**
 * What is waiting on the person, as the server's attention registry answers it. One of the
 * `backendClient` domain modules spread into the facade in `./client`.
 *
 * The roster is read over HTTP because the live `attention.updated` frame only carries changes
 * that happen while this window listens: a request asked, a plan presented or a mention made
 * while the window was closed would otherwise be invisible until something else changed.
 */

import type { AttentionItem } from '@localixai/api/client'
import { client, unwrap } from './internal'

export const attentionApi = {
  /** Every open item for the person, across all of their conversations. */
  async listAttention(): Promise<AttentionItem[]> {
    const json = await unwrap(await client.rpc.attention.$get())
    return json.items
  },
}
