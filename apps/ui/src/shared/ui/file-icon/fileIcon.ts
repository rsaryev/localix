import { createElement, type ComponentType } from 'react'
import type { IconifyIcon } from '@iconify/types'
import { File, FileCode, FileText, FileCog } from 'lucide-react'
import { contributedVscFileIcon } from '@/shared/contrib/iconContributions'

// Real "vscode-icons" branded glyphs (the yellow JS square, HTML5 shield, React
// atom, …) from that icon collection. Imported per-icon
// from @iconify-icons/vscode-icons so the bundle carries ONLY the ~40 we map,
// not the whole 1200-icon collection, and renders fully offline (no Iconify API).
import fileTypeJs from '@iconify-icons/vscode-icons/file-type-js'
import fileTypeReactjs from '@iconify-icons/vscode-icons/file-type-reactjs'
import fileTypeReactts from '@iconify-icons/vscode-icons/file-type-reactts'
import fileTypeTs from '@iconify-icons/vscode-icons/file-type-typescript-official'
import fileTypeJson from '@iconify-icons/vscode-icons/file-type-json'
import fileTypeCss from '@iconify-icons/vscode-icons/file-type-css'
import fileTypeScss from '@iconify-icons/vscode-icons/file-type-scss'
import fileTypeHtml from '@iconify-icons/vscode-icons/file-type-html'
import fileTypeMarkdown from '@iconify-icons/vscode-icons/file-type-markdown'
import fileTypePython from '@iconify-icons/vscode-icons/file-type-python'
import fileTypeRust from '@iconify-icons/vscode-icons/file-type-rust'
import fileTypeGo from '@iconify-icons/vscode-icons/file-type-go'
import fileTypeRuby from '@iconify-icons/vscode-icons/file-type-ruby'
import fileTypeJava from '@iconify-icons/vscode-icons/file-type-java'
import fileTypeC from '@iconify-icons/vscode-icons/file-type-c'
import fileTypeCpp from '@iconify-icons/vscode-icons/file-type-cpp'
import fileTypeShell from '@iconify-icons/vscode-icons/file-type-shell'
import fileTypeYaml from '@iconify-icons/vscode-icons/file-type-yaml'
import fileTypeToml from '@iconify-icons/vscode-icons/file-type-toml'
import fileTypeSql from '@iconify-icons/vscode-icons/file-type-sql'
import fileTypeSvg from '@iconify-icons/vscode-icons/file-type-svg'
import fileTypeImage from '@iconify-icons/vscode-icons/file-type-image'
import fileTypeVue from '@iconify-icons/vscode-icons/file-type-vue'
import fileTypeSvelte from '@iconify-icons/vscode-icons/file-type-svelte'
import fileTypeNpm from '@iconify-icons/vscode-icons/file-type-npm'
import fileTypeTsconfig from '@iconify-icons/vscode-icons/file-type-tsconfig'
import fileTypeGit from '@iconify-icons/vscode-icons/file-type-git'
import fileTypeVite from '@iconify-icons/vscode-icons/file-type-vite'
import fileTypeEslint from '@iconify-icons/vscode-icons/file-type-eslint'
import fileTypePrettier from '@iconify-icons/vscode-icons/file-type-prettier'
import fileTypeTailwind from '@iconify-icons/vscode-icons/file-type-tailwind'
import fileTypeLicense from '@iconify-icons/vscode-icons/file-type-license'
import defaultFolder from '@iconify-icons/vscode-icons/default-folder'
import defaultFolderOpened from '@iconify-icons/vscode-icons/default-folder-opened'

type IconComponent = ComponentType<{ className?: string }>

export interface FileIconSpec {
  Icon: IconComponent
  /** Tailwind text-color class for lucide fallbacks. Empty for the branded
   *  vscode-icons glyphs — those carry their own colors in the SVG. */
  color: string
}

/**
 * Wrap an Iconify icon-data object into a stable `{ className }` component so it
 * slots into the existing `{ Icon, color }` contract every consumer already
 * uses. Cached per icon-data so the component identity is stable across renders
 * (React keeps the DOM node instead of remounting the SVG).
 */
const vscCache = new Map<IconifyIcon, IconComponent>()
function vsc(data: IconifyIcon): FileIconSpec {
  let Comp = vscCache.get(data)
  if (!Comp) {
    // The catalog contains trusted, build-time vscode-icons data and only needs
    // the basic `body` + viewBox contract. Pulling the generic Iconify React
    // runtime here adds collection loading, transformations and API machinery
    // that no file icon uses. A native SVG keeps identical offline rendering
    // while leaving that runtime out of the startup graph.
    Comp = ({ className }: { className?: string }) =>
      createElement('svg', {
        className,
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: `0 0 ${data.width ?? 16} ${data.height ?? 16}`,
        width: '1em',
        height: '1em',
        focusable: false,
        'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: data.body },
      })
    vscCache.set(data, Comp)
  }
  return { Icon: Comp, color: '' }
}

const VSC_BY_EXT: Record<string, IconifyIcon> = {
  ts: fileTypeTs,
  mts: fileTypeTs,
  cts: fileTypeTs,
  tsx: fileTypeReactts,
  js: fileTypeJs,
  mjs: fileTypeJs,
  cjs: fileTypeJs,
  jsx: fileTypeReactjs,
  json: fileTypeJson,
  jsonc: fileTypeJson,
  css: fileTypeCss,
  scss: fileTypeScss,
  sass: fileTypeScss,
  less: fileTypeCss,
  html: fileTypeHtml,
  htm: fileTypeHtml,
  md: fileTypeMarkdown,
  mdx: fileTypeMarkdown,
  py: fileTypePython,
  rs: fileTypeRust,
  go: fileTypeGo,
  rb: fileTypeRuby,
  java: fileTypeJava,
  c: fileTypeC,
  h: fileTypeC,
  cpp: fileTypeCpp,
  cc: fileTypeCpp,
  hpp: fileTypeCpp,
  sh: fileTypeShell,
  bash: fileTypeShell,
  zsh: fileTypeShell,
  yml: fileTypeYaml,
  yaml: fileTypeYaml,
  toml: fileTypeToml,
  sql: fileTypeSql,
  svg: fileTypeSvg,
  png: fileTypeImage,
  jpg: fileTypeImage,
  jpeg: fileTypeImage,
  gif: fileTypeImage,
  webp: fileTypeImage,
  ico: fileTypeImage,
  vue: fileTypeVue,
  svelte: fileTypeSvelte,
}

const VSC_BY_NAME: Record<string, IconifyIcon> = {
  'package.json': fileTypeNpm,
  'package-lock.json': fileTypeNpm,
  'tsconfig.json': fileTypeTsconfig,
  '.gitignore': fileTypeGit,
  '.gitattributes': fileTypeGit,
  'vite.config.ts': fileTypeVite,
  'vite.config.js': fileTypeVite,
  '.eslintrc': fileTypeEslint,
  '.eslintrc.json': fileTypeEslint,
  '.eslintrc.js': fileTypeEslint,
  'eslint.config.js': fileTypeEslint,
  'eslint.config.mjs': fileTypeEslint,
  '.prettierrc': fileTypePrettier,
  'prettier.config.js': fileTypePrettier,
  'tailwind.config.ts': fileTypeTailwind,
  'tailwind.config.js': fileTypeTailwind,
  license: fileTypeLicense,
  'license.md': fileTypeLicense,
}

// Lucide fallbacks — for extensions/names the vscode set above doesn't cover,
// keep a colored monochrome glyph so nothing renders as a bare default.
// Colors come from the `--conn-*` identity family, not the raw Tailwind palette:
// these are theme-owned hues, so a file type re-tunes with the theme (and with
// light/dark) instead of staying a fixed swatch on every ground.
const BY_EXT: Record<string, FileIconSpec> = {
  cs: { Icon: FileCode, color: 'text-conn-green' },
  php: { Icon: FileCode, color: 'text-conn-violet' },
  kt: { Icon: FileCode, color: 'text-conn-red' },
  swift: { Icon: FileCode, color: 'text-conn-red' },
  env: { Icon: FileCog, color: 'text-conn-amber' },
  lock: { Icon: FileCog, color: 'text-text-faint' },
  txt: { Icon: FileText, color: 'text-text-faint' },
  log: { Icon: FileText, color: 'text-text-faint' },
}

const BY_NAME: Record<string, FileIconSpec> = {
  '.env': { Icon: FileCog, color: 'text-conn-amber' },
  '.env.local': { Icon: FileCog, color: 'text-conn-amber' },
  makefile: { Icon: FileCog, color: 'text-text-faint' },
}

const DEFAULT_FILE: FileIconSpec = { Icon: File, color: 'text-text-faint' }

/** Pick an icon for a file name — branded vscode-icons first, then a colored lucide fallback. */
export function fileIcon(name: string): FileIconSpec {
  const lower = name.toLowerCase()
  if (VSC_BY_NAME[lower]) return vsc(VSC_BY_NAME[lower])
  if (BY_NAME[lower]) return BY_NAME[lower]
  const contributed = contributedVscFileIcon(lower)
  if (contributed) return vsc(contributed)
  const ext = lower.includes('.') ? lower.split('.').pop()! : ''
  if (VSC_BY_EXT[ext]) return vsc(VSC_BY_EXT[ext])
  return BY_EXT[ext] ?? DEFAULT_FILE
}

/** Folder icon (open/closed) — the branded vscode-icons default folder. */
export function folderIcon(open: boolean): FileIconSpec {
  return vsc(open ? defaultFolderOpened : defaultFolder)
}
