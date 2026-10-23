import type { LogSeverity } from './logLines'

export function toggleLogSeverity(
  current: LogSeverity[],
  severity: LogSeverity,
  checked: boolean,
): LogSeverity[] {
  if (checked) {
    return current.includes(severity) ? current : [...current, severity]
  }

  // An empty severity set looks like a broken viewer. Keep the final category on.
  return current.length === 1 ? current : current.filter((item) => item !== severity)
}

export function safeLogName(value: string): string {
  const safe = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  return safe || 'logs'
}

export function logDownloadFilename(downloadName: string, now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[:]/g, '-')
    .replace(/\.\d{3}Z$/, 'Z')
  return `${safeLogName(downloadName)}-${stamp}.log`
}
