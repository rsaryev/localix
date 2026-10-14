/**
 * External messaging channel contracts — OWNED by
 * `@localixai/plugin-sdk`; re-exported here so the historical import surface
 * (native.ts, channel-host.ts, chat/service, loader) stays unchanged.
 * The runtime that consumes them (looksLikeChannel/asChannelArray, the host)
 * lives in native.ts / channel-host.ts.
 */
export type {
  ChannelContext,
  ChannelInboundMessage,
  ChannelInboundResult,
  ChannelModelOption,
  ChannelRunEvent,
  ChannelSessionSummary,
  ChannelWorkspaceApi,
  PluginChannel,
} from '@localixai/plugin-sdk/backend'
