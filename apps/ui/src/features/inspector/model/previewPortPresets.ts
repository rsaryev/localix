/**
 * Curated dev-server port presets for the preview toolbar's one-click "jump to a
 * common port" menu. Pure data + a URL helper — no React, no DOM. This is a MANUAL
 * jump list: the user picks a known port.
 *
 * Ordered by frontend frequency first, then backend and tooling.
 */

export interface PreviewPortPreset {
  /** Short framework/tool name shown as the row label. */
  label: string
  /** The localhost port to navigate the preview to. */
  port: number
  /** Muted secondary hint — what typically listens on this port. */
  hint?: string
}

export const PREVIEW_PORT_PRESETS: readonly PreviewPortPreset[] = [
  { label: 'Vite', port: 5173, hint: 'vite, sveltekit' },
  { label: 'Vite (alt)', port: 5174, hint: 'second vite instance' },
  { label: 'Vite preview', port: 4173, hint: 'vite preview' },
  { label: 'Next.js', port: 3000, hint: 'next, express, rails' },
  { label: 'Next.js (alt)', port: 3001, hint: 'second next instance' },
  { label: 'Angular', port: 4200, hint: 'angular cli' },
  { label: 'Astro', port: 4321, hint: 'astro' },
  { label: 'Storybook', port: 6006, hint: 'storybook' },
  { label: 'Webpack', port: 8080, hint: 'webpack, vue cli' },
  { label: 'Metro', port: 8081, hint: 'react native metro' },
  { label: 'Django / FastAPI', port: 8000, hint: 'django, fastapi, uvicorn' },
  { label: 'Flask', port: 5000, hint: 'flask' },
  { label: 'Jupyter', port: 8888, hint: 'jupyter notebook' },
  { label: 'Gradio', port: 7860, hint: 'gradio' },
  { label: 'Ollama', port: 11434, hint: 'ollama api' },
]

/** Build the localhost URL a preset navigates the preview to. */
export function presetUrl(port: number): string {
  return `http://localhost:${port}/`
}
