import { createFormatAdapterRegistry, type FormatAdapter } from '../ext/format-adapter'
import { agentRecordSchema } from './contracts'

export const NATIVE_AGENT_FORMAT = 'localix.agent-definition'
export const NATIVE_AGENT_FORMAT_VERSION = 1

const nativeAgentJsonAdapter: FormatAdapter = {
  format: NATIVE_AGENT_FORMAT,
  version: NATIVE_AGENT_FORMAT_VERSION,
  decode: (text) => ({ value: JSON.parse(text), diagnostics: [] }),
}

const formats = createFormatAdapterRegistry(agentRecordSchema)
formats.register(nativeAgentJsonAdapter)

/** Explicit native format selection; JSON files never fall back to an external dialect. */
export const decodeNativeAgent = (text: string, source: string) =>
  formats.decode({
    source,
    text,
    format: NATIVE_AGENT_FORMAT,
    version: NATIVE_AGENT_FORMAT_VERSION,
  })
