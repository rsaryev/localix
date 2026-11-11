import type { PluginIssue } from '@rsaryev/llx-plugin/format'

/** An issue as one line: its message, then where it is unless the message already says so. */
export const issueLine = ({ message, path }: PluginIssue): string =>
  message.includes(path) ? message : `${message} (${path})`
