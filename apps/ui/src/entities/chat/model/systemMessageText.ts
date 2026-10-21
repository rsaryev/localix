const DECORATIVE_SYSTEM_GLYPHS = /(?:[\p{Extended_Pictographic}✓✔✕✖✗○]\uFE0F?)[ \t]?/gu

/**
 * System-owned transcript rows use real UI icons for status. Strip legacy
 * decorative glyphs from persisted text so old command results do not keep
 * rendering emoji after the presentation has moved to structured chrome.
 */
export function cleanSystemMessageText(text: string): string {
  return text.replace(DECORATIVE_SYSTEM_GLYPHS, '').trim()
}
