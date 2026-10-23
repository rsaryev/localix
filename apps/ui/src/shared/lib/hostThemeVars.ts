import { HOST_THEME_VARIABLES } from '@localixai/mini-app-sdk/ui'

/** Read the forwarded vars from the live host document as a `name: value;` CSS block. */
export function collectHostThemeCss(): string {
  const styles = getComputedStyle(document.documentElement)
  return HOST_THEME_VARIABLES.map((name) => {
    const value = styles.getPropertyValue(name).trim()
    return value ? `${name}: ${value};` : ''
  })
    .filter(Boolean)
    .join('\n  ')
}
