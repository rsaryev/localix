/**
 * Provider identities for the roster, resource tree and reference menu.
 * Claude and Codex are shared kit exports; other provider marks live here.
 * Path data and provenance are documented in ATTRIBUTION.md.
 *
 * Every mark is single-colour and drawn with `currentColor`, so it inherits the surrounding text
 * colour and needs no light/dark variant.
 */

export { ClaudeMark, CodexMark } from '@localixai/kit/coding-agent-marks'

interface MarkProps {
  className?: string
}

/**
 * The filled glyphs use a 100 × 100 frame; the stroked Hermes mark keeps its own geometry.
 */
function Mark({ className, children }: MarkProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

/** GitHub's Copilot mark — the `copilot` CLI. */
export function CopilotMark({ className }: MarkProps) {
  return (
    <Mark className={className}>
      <path
        d="M79.7057 21.6044C85.0857 27.2967 87.3915 35.1429 88.3522 46.0659C90.8885 46.0659 93.2711 46.6428 94.8851 48.8352L97.8826 52.9121C98.728 54.0659 99.1892 55.4505 99.1892 56.9121V67.9505C99.1833 68.6605 99.0137 69.3596 98.6938 69.9934C98.3739 70.6271 97.9122 71.1784 97.3446 71.6044C83.7791 81.5275 67.0241 89.5275 50 89.5275C31.1698 89.5275 12.2627 78.6428 2.65542 71.6044C2.08785 71.1784 1.62614 70.6271 1.30621 69.9934C0.986278 69.3596 0.816752 68.6605 0.810822 67.9505L0.810822 56.9121C0.810822 55.4505 1.27197 54.0659 2.11741 52.8736L5.11488 48.8352C6.7289 46.6428 9.1115 46.0659 11.6478 46.0659C12.6085 35.1429 14.8759 27.2967 20.2944 21.6044C30.5165 10.7582 44.0819 9.52747 49.8463 9.52747H50C55.6491 9.52747 69.3683 10.6429 79.7057 21.6044ZM50 39.7967C48.8471 39.7967 47.5021 39.8736 46.0418 40.0275C45.678 41.7486 44.8848 43.3496 43.7361 44.6813C42.1163 46.2842 40.1962 47.5511 38.0858 48.4092C35.9755 49.2672 33.7165 49.6995 31.4388 49.6813C28.8256 49.6813 26.0971 49.1044 23.8683 47.6813C21.7547 48.4121 19.7179 49.4121 19.5642 51.9121C19.3721 56.6044 19.3336 61.3352 19.3336 66.0659C19.3336 68.4121 19.3336 70.7967 19.2568 73.1813C19.2568 74.5659 20.1022 75.8352 21.3704 76.4121C31.5156 81.0275 41.1613 83.3736 50 83.3736C58.8387 83.3736 68.446 81.0659 78.6297 76.4121C79.2511 76.1286 79.7794 75.6746 80.1535 75.1028C80.5276 74.531 80.7321 73.8647 80.7432 73.1813C80.8585 66.1044 80.7432 58.9505 80.4358 51.9121C80.2821 49.3736 78.2454 48.4121 76.1318 47.6813C73.9029 49.1044 71.136 49.6429 68.5612 49.6429C66.2861 49.6662 64.0288 49.2399 61.9186 48.3885C59.8084 47.5371 57.8868 46.2773 56.2639 44.6813C55.1153 43.3496 54.322 41.7486 53.9582 40.0275C52.6516 39.8736 51.3066 39.8352 50 39.7967ZM39.6242 56.7198C41.853 56.7198 43.6592 58.489 43.6592 60.7198V68.1044C43.6592 69.1653 43.2381 70.1827 42.4886 70.9328C41.7391 71.683 40.7226 72.1044 39.6626 72.1044C38.6026 72.1044 37.5861 71.683 36.8366 70.9328C36.087 70.1827 35.666 69.1653 35.666 68.1044V60.6813C35.666 58.4505 37.4337 56.6813 39.6626 56.6813L39.6242 56.7198ZM60.1453 56.7198C62.3742 56.7198 64.1419 58.489 64.1419 60.7198V68.1044C64.1419 69.1653 63.7208 70.1827 62.9713 70.9328C62.2218 71.683 61.2052 72.1044 60.1453 72.1044C59.0853 72.1044 58.0688 71.683 57.3192 70.9328C56.5697 70.1827 56.1487 69.1653 56.1487 68.1044V60.6813C56.1487 58.4505 57.9548 56.6813 60.1453 56.6813V56.7198ZM32.0921 20.4121C27.788 20.8352 24.1757 22.2582 22.3311 24.2582C18.3345 28.6044 19.1799 39.6813 21.4857 42.0275C23.7655 43.9275 26.6682 44.9142 29.6326 44.7967C32.2458 44.7967 37.1647 44.2198 41.1998 40.1044C43.0059 38.3736 44.0819 34.0659 43.9666 29.7198C43.8514 26.2198 42.8522 23.2967 41.3919 22.0659C39.7779 20.6813 36.1655 20.0659 32.0921 20.4121ZM58.6081 22.0659C57.1478 23.2967 56.1487 26.2198 56.0334 29.7198C55.9181 34.0659 56.9941 38.3736 58.8003 40.1044C60.3121 41.6165 62.111 42.8106 64.0909 43.6164C66.0708 44.4223 68.1918 44.8236 70.329 44.7967C73.7492 44.7967 76.8619 43.6813 78.5144 42.0275C80.8201 39.6813 81.6655 28.6044 77.6689 24.2198C75.8243 22.2967 72.212 20.8352 67.9079 20.4121C63.8345 20.0275 60.2221 20.6813 58.6081 22.0659ZM50 31.0659C49.0009 31.0659 47.848 31.1429 46.5414 31.2582C46.6951 31.9121 46.7335 32.6813 46.8104 33.4505C46.8104 34.0275 46.8104 34.6044 46.7335 35.1813C47.9633 35.0659 49.0393 35.0659 50 35.0659C50.9992 35.0659 52.0367 35.0659 53.2665 35.1813C53.1896 34.5659 53.1896 34.0275 53.1896 33.4505C53.2665 32.6813 53.3049 31.9121 53.4586 31.2582C52.152 31.1429 50.9992 31.0659 50 31.0659Z"
        fill="currentColor"
      />
    </Mark>
  )
}

/**
 * Nous Research's Hermes mark — the `hermes` CLI.
 *
 * The one glyph in this file NOT from the CodexBar set, which has no Hermes icon. Taken from the
 * agent's own `acp_registry/icon.svg` (MIT, Nous Research) and it diverges from the other five in a
 * way worth stating: a `0 0 16 16` box drawn with STROKES rather than a `0 0 100 100` filled path.
 * The stroke widths are authored for 16px, so it holds its weight at the 14px a menu row uses, and
 * `stroke="currentColor"` was already how the source wrote it — but it is a different drawing family,
 * and pretending otherwise by redrawing it as a filled path would invent geometry the author did not.
 */
export function HermesMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" aria-hidden className={className}>
      <path d="M8 1.5v13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <path
        d="M8 3.25c-2.35-1.4-4.7-.95-6.25.35 1.85-.2 3.8.2 5.55 1.55"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M8 3.25c2.35-1.4 4.7-.95 6.25.35-1.85-.2-3.8.2-5.55 1.55"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M8 13.25c-2.3-1-3.05-2.65-1.35-4.15-2 .8-2.35 2.95-.35 4"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M8 13.25c2.3-1 3.05-2.65 1.35-4.15 2 .8 2.35 2.95.35 4"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

/** Google's Gemini spark — the `gemini` CLI. */
export function GeminiMark({ className }: MarkProps) {
  return (
    <Mark className={className}>
      <path
        d="M48.217 10.7381C48.8274 9.07596 51.1705 9.10263 51.7434 10.7779L53.3442 15.4571C55.7354 22.447 59.6489 28.8096 64.7979 34.079C69.947 39.3483 76.2012 43.3909 83.1024 45.9106L88.2657 47.7954C89.9088 48.3953 89.9123 50.7344 88.2711 51.3392L83.0955 53.2469C76.3818 55.7214 70.2839 59.6393 65.2262 64.728C60.1684 69.8168 56.2722 75.9542 53.8085 82.7134L51.783 88.2704C51.1836 89.915 48.8758 89.9193 48.2703 88.2772L46.1551 82.5404C43.6813 75.8303 39.7939 69.7395 34.7602 64.6867C29.7265 59.6339 23.6659 55.739 16.9952 53.2698L11.7265 51.3198C10.0944 50.7155 10.0901 48.3924 11.7198 47.7822L17.0915 45.7707C23.7343 43.2834 29.7654 39.3804 34.7722 34.3288C39.7791 29.2771 43.6435 23.196 46.1013 16.5012L48.217 10.7381Z"
        fill="currentColor"
      />
    </Mark>
  )
}

/** The opencode mark — the `opencode` CLI. */
export function OpencodeMark({ className }: MarkProps) {
  return (
    <Mark className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M80 88H20V12H80V88ZM35 27H65V72H35V27Z"
        fill="currentColor"
      />
    </Mark>
  )
}
