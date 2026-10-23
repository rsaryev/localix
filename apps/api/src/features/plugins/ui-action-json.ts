import { UnprocessableError } from '../../lib/domain-errors'

/** A plugin UI action's payload or result: JSON, and at most this many bytes of it. */
const MINI_APP_UI_ACTION_JSON_CAP_BYTES = 256 * 1024

export function jsonValueWithinCap(value: unknown, label: string): unknown {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value ?? null)
  } catch {
    throw new UnprocessableError(
      'plugin_ui_action_invalid_json',
      `${label} must be JSON-serializable`,
    )
  }
  if (encoded === undefined) {
    throw new UnprocessableError(
      'plugin_ui_action_invalid_json',
      `${label} must be JSON-serializable`,
    )
  }
  if (Buffer.byteLength(encoded) > MINI_APP_UI_ACTION_JSON_CAP_BYTES) {
    throw new UnprocessableError(
      'plugin_ui_action_too_large',
      `${label} exceeds ${MINI_APP_UI_ACTION_JSON_CAP_BYTES} bytes`,
    )
  }
  return JSON.parse(encoded) as unknown
}
