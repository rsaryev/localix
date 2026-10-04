/**
 * The person's side of what the agent asks of them beyond a blocking card: answering or skipping
 * a queued question (`ask` with `wait: false`), and ticking a box in a reply's checklist. One of
 * the `backendClient` domain modules spread into the facade in `./client`.
 */

import type { AskToolAnswer } from '@localixai/api/client'
import { client, unwrap } from './internal'

export const questionsApi = {
  /**
   * Answer a question the agent queued (`q-3`). Rejects with 404 when it is no longer open and
   * 409 when another tab answered it first — the server's next push removes it either way.
   */
  async answerQuestion(
    sessionId: string,
    questionId: string,
    answers: AskToolAnswer[],
  ): Promise<void> {
    await unwrap<{ ok: true }>(
      await client.rpc.sessions[':id'].questions.answer.$post({
        param: { id: sessionId },
        json: { questionId, answers },
      }),
    )
  },

  /** Decline to answer a queued question; the agent is told in its next prompt. */
  async skipQuestion(sessionId: string, questionId: string): Promise<void> {
    await unwrap<{ ok: true }>(
      await client.rpc.sessions[':id'].questions.skip.$post({
        param: { id: sessionId },
        json: { questionId },
      }),
    )
  },

  /** Tick or clear one box of a reply's checklist; the stored marks arrive as the updated message. */
  async checkMessageTask(
    sessionId: string,
    messageId: string,
    key: string,
    checked: boolean,
  ): Promise<{ ok: true; checked: boolean }> {
    return unwrap<{ ok: true; checked: boolean }>(
      await client.rpc.sessions[':id'].messages[':messageId'].tasks.$post({
        param: { id: sessionId, messageId },
        json: { key, checked },
      }),
    )
  },
}
