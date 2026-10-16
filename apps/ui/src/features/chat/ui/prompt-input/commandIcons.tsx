/**
 * Shared SVG icon components for slash commands.
 * Each icon is 14×14, uses currentColor stroke, and follows a consistent style.
 * Import individual icons — do not use a barrel export that pulls unused JSX.
 */

const S = ({ d }: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d={d}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** Recurring loop — a circular arrow (used by /loop). */
export const LoopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M13 8a5 5 0 1 1-1.46-3.54"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13 2.5V5.5H10"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** Model — stacked layers. */
export const ModelIcon = () => (
  <S d="M8 2.5l5 2.5-5 2.5-5-2.5 5-2.5zM3 8l5 2.5L13 8M3 11l5 2.5L13 11" />
)

export const CompactIcon = () => <S d="M3 4h10M5 8h6M7 12h2" />

export const ClearIcon = () => <S d="M3.5 5.5h9M6 5.5V4h4v1.5M5 5.5l.6 7h4.8l.6-7" />

export const UsageIcon = () => <S d="M2.5 13V7M6 13V3M9.5 13V9M13 13V5" />

export const ForkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="4.5" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="11.5" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="8" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M4.5 5.6v1.4c0 1 .8 1.8 1.8 1.8h3.4c1 0 1.8-.8 1.8-1.8V5.6M8 9.2v1.2"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** UI-anchor navigation — a folder opening into an external target. */
export const OpenIcon = () => (
  <S d="M2.5 5.5h4l1.3 1.5h5.7l-1.2 5.5H3.5L2.5 5.5zM4 5.5v-2h3l1.2 1.2H12" />
)

export const MemoryIcon = () => <S d="M5 2.5h6a1 1 0 011 1v9l-4-2-4 2v-9a1 1 0 011-1z" />

export const SkillsIcon = () => (
  <S d="M8 1.5l1.8 3.7 4.1.6-3 2.9.7 4.1L8 11.4 4.4 12.8l.7-4.1-3-2.9 4.1-.6L8 1.5z" />
)

/** MCP — a plug/connector metaphor for external tool servers. */
export const McpIcon = () => <S d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2a3.5 3.5 0 01-7 0v-2zM8 11v2.5" />

/** Plugins — a puzzle-piece metaphor for drop-in extensions. */
export const PluginsIcon = () => (
  <S d="M6 2.5a1.5 1.5 0 013 0V4h2.5v2.5H13a1.5 1.5 0 010 3h-1.5V12H9v-1.5a1.5 1.5 0 00-3 0V12H3.5V9.5H5a1.5 1.5 0 000-3H3.5V4H6V2.5z" />
)

/** Agent providers — a stacked-boxes metaphor for drop-in executors/LLM backends. */
export const ProvidersIcon = () => (
  <S d="M8 1.5l5.5 3v7l-5.5 3-5.5-3v-7l5.5-3zM2.5 4.5L8 7.5l5.5-3M8 7.5v7" />
)

/** Help — a question mark in a circle (used by /help). */
export const HelpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M6.4 6.2a1.7 1.7 0 0 1 3.2.6c0 1.1-1.6 1.4-1.6 2.4"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M8 11.4h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)
