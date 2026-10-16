const WORDS = /[\p{Letter}\p{Number}]+/gu

/** Accent-insensitive, Unicode-aware text used by every Localix local-search surface. */
export function normalizeSearchText(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/\p{Mark}/gu, '')
      .toLocaleLowerCase()
      .match(WORDS)
      ?.join(' ') ?? ''
  )
}

export function words(value: string): string[] {
  return value ? value.split(' ') : []
}
