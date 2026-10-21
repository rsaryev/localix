/**
 * The host's account of one script: what it has output and how many calls it has made, checked on
 * every message the worker sends. The VM's own checks are a courtesy to the script; these are the
 * ones the host relies on, because nothing measured inside the VM is trusted.
 */
import type { ScriptOutputItem } from '@localixai/agent/runtime'

import { sniffImage } from './image'
import {
  MAX_CALL_ARGS_CHARS,
  MAX_CALLS,
  MAX_CONCURRENT_CALLS,
  MAX_OUTPUT_CHARS,
  MAX_OUTPUT_ITEMS,
  MAX_TOTAL_CALL_ARGS_CHARS,
} from './limits'

/** A limit the script passed; the run fails with its message. */
export class ScriptBudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScriptBudgetError'
  }
}

export interface RunBudget {
  /** The item as the host keeps it: an image the bytes do not back becomes a note. */
  output(item: ScriptOutputItem): ScriptOutputItem
  /** The return value's JSON, counted as output. */
  returnValue(json: string | undefined): void
  /** Admits one call's arguments, before the call is queued. */
  call(args: string | undefined): void
}

export function createRunBudget(): RunBudget {
  let outputChars = 0
  let outputItems = 0
  let calls = 0
  let argsChars = 0

  const countOutput = (chars: number) => {
    outputChars += chars
    if (outputChars > MAX_OUTPUT_CHARS || outputItems > MAX_OUTPUT_ITEMS) {
      throw new ScriptBudgetError(
        `The script's output passed ${MAX_OUTPUT_CHARS} characters or ${MAX_OUTPUT_ITEMS} items. Output a summary instead.`,
      )
    }
  }

  return {
    output(item) {
      outputItems++
      if (item.type === 'text') {
        countOutput(item.text.length)
        return item
      }
      countOutput(item.data.length)
      const mimeType = sniffImage(item.data)
      if (!mimeType) {
        return { type: 'text', text: '[image dropped: not valid PNG, JPEG, GIF or WebP data]' }
      }
      return { type: 'image', data: item.data, mimeType }
    },
    returnValue(json) {
      if (json !== undefined) countOutput(json.length)
    },
    call(args) {
      const chars = args?.length ?? 0
      if (++calls > MAX_CALLS) {
        throw new ScriptBudgetError(
          `The script made more than ${MAX_CALLS} tool calls. Make fewer, larger calls.`,
        )
      }
      if (chars > MAX_CALL_ARGS_CHARS) {
        throw new ScriptBudgetError(
          `A tool call's arguments passed ${MAX_CALL_ARGS_CHARS} characters.`,
        )
      }
      argsChars += chars
      if (argsChars > MAX_TOTAL_CALL_ARGS_CHARS) {
        throw new ScriptBudgetError(
          `The script's tool call arguments passed ${MAX_TOTAL_CALL_ARGS_CHARS} characters in all.`,
        )
      }
    },
  }
}

/** At most {@link MAX_CONCURRENT_CALLS} calls hold a slot; the rest wait in order. */
export function createCallSlots(limit = MAX_CONCURRENT_CALLS) {
  let running = 0
  let closed = false
  const waiting: (() => void)[] = []
  return {
    acquire(): Promise<void> {
      if (closed || running < limit) {
        running++
        return Promise.resolve()
      }
      return new Promise((resolve) => waiting.push(resolve))
    },
    /** Hands the slot to the next waiting call, if any. */
    release(): void {
      if (closed) return
      const next = waiting.shift()
      if (next) next()
      else running--
    },
    /** The run ended: wakes every waiting call, so each sees that, and hands out no more slots. */
    close(): void {
      closed = true
      for (const next of waiting.splice(0)) next()
    },
  }
}
