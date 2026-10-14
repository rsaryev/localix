/**
 * Format a Date as SQLite's CURRENT_TIMESTAMP shape: "YYYY-MM-DD HH:MM:SS" (UTC,
 * space-separated, no millis/`Z`). Stored timestamp columns use this format, so
 * comparisons must too — a raw toISOString() ("…THH:…Z") string-sorts wrong
 * (' ' < 'T'), silently breaking range filters. One source of truth for that
 * conversion across the usage ledger and other timestamp comparisons.
 */
export function toSqliteDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}
