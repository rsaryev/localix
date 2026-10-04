/**
 * Shell integration: inject OSC 133 semantic-prompt markers into an interactive
 * PTY's shell so the terminal UI can show per-command exit codes and navigate
 * between prompts. This is a SPAWN-TIME concern only — it produces extra shell
 * argv + env for {@link PtySpawnOptions}, so the {@link PtyBackend} port stays
 * mechanical (no knowledge of shell integration).
 *
 * The generated rc script always sources the user's own config FIRST and layers
 * hooks additively, and everything is wrapped so a shell that doesn't cooperate
 * (or an unknown shell) simply runs normally — integration is strictly opt-out
 * safe. Only bash and zsh are supported; any other shell returns `null` (no
 * integration, plain shell).
 *
 * Markers emitted (the OSC 133 shell-integration grammar, understood by many tools):
 *   OSC 133 ; A      prompt start
 *   OSC 133 ; B      prompt end / input start
 *   OSC 133 ; C      command output start (pre-exec)
 *   OSC 133 ; D ; N  command finished with exit code N
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'

export type ShellKind = 'bash' | 'zsh'

/** Classify a shell path by its basename; `null` for anything we don't integrate. */
export function detectShellKind(shellPath: string | undefined): ShellKind | null {
  if (!shellPath) return null
  const name = basename(shellPath)
    .toLowerCase()
    .replace(/\.exe$/, '')
  if (name === 'bash') return 'bash'
  if (name === 'zsh') return 'zsh'
  return null
}

/**
 * bash rc content. Replicates a LOGIN shell's startup first (a local terminal
 * runs `bash` as a login shell, but `--rcfile` forces interactive NON-login —
 * which would skip /etc/profile + ~/.bash_profile where many setups configure
 * PATH/env): /etc/profile, then the FIRST of ~/.bash_profile | ~/.bash_login |
 * ~/.profile exactly like bash itself, falling back to ~/.bashrc when no
 * profile file exists (a login .bash_profile conventionally sources .bashrc
 * itself). Then adds an OSC 133 emitter driven by PROMPT_COMMAND (prompt marks
 * + exit code) and a DEBUG trap (command start). The DEBUG trap preserves `$?`
 * across itself so PROMPT_COMMAND reads the real exit status of the last
 * command. HISTFILE needs no repair here — bash defaults it to ~/.bash_history
 * regardless of the rcfile.
 */
export function bashInitScript(): string {
  return [
    '# Localix shell integration (OSC 133). Replays your login-shell startup first;',
    '# failures here must never break the shell.',
    'if [ -f /etc/profile ]; then . /etc/profile; fi',
    'if [ -f ~/.bash_profile ]; then . ~/.bash_profile;',
    'elif [ -f ~/.bash_login ]; then . ~/.bash_login;',
    'elif [ -f ~/.profile ]; then . ~/.profile;',
    'elif [ -f ~/.bashrc ]; then . ~/.bashrc; fi',
    '__lx_esc() { printf "\\033]133;%s\\007" "$1"; }',
    '__lx_preexec() {',
    '  local __ec=$?',
    '  if [ -n "$__lx_prompting" ] || [ -n "$COMP_LINE" ]; then return $__ec; fi',
    '  case "$BASH_COMMAND" in __lx_*) return $__ec;; esac',
    '  if [ -z "$__lx_in_cmd" ]; then __lx_in_cmd=1; __lx_esc "C"; fi',
    '  return $__ec',
    '}',
    '# B (input start) must fire where the INPUT begins — i.e. at the END of the',
    '# rendered prompt. PROMPT_COMMAND runs BEFORE PS1 paints, so emitting B there',
    '# would anchor the input column at 0 and the terminal client would read the',
    '# prompt text as typed input. Instead B rides as a zero-width \\[..\\] suffix',
    '# ON PS1 itself, re-appended each prompt (some setups rebuild PS1), never doubled.',
    '__lx_b_mark="\\[\\033]133;B\\007\\]"',
    '__lx_prompt_command() {',
    '  local __ec=$?',
    '  __lx_prompting=1',
    '  __lx_esc "D;$__ec"; __lx_esc "A"',
    '  case "$PS1" in',
    '    *"$__lx_b_mark") ;;',
    '    *) PS1="${PS1}${__lx_b_mark}" ;;',
    '  esac',
    '  __lx_in_cmd=""',
    '  __lx_prompting=""',
    '}',
    'case "$PROMPT_COMMAND" in',
    '  *__lx_prompt_command*) ;;',
    '  *) PROMPT_COMMAND="__lx_prompt_command${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;',
    'esac',
    'trap "__lx_preexec" DEBUG',
    '',
  ].join('\n')
}

/**
 * zsh .zshrc content for an overridden ZDOTDIR. Sources the user's real config
 * FIRST, in login-shell order — .zshenv → .zprofile → .zshrc, with .zlogin at
 * the very end (a local terminal runs a LOGIN zsh; our ZDOTDIR override would
 * otherwise skip the user's .zprofile/.zlogin where PATH/env often live) — then
 * repairs the history location and finally registers precmd / preexec hooks via
 * `add-zsh-hook` (which APPENDS — it never clobbers the user's own hooks).
 *
 * HISTORY REPAIR — the "terminal doesn't see my shell history" root cause:
 * macOS /etc/zshrc sets `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history` and runs for
 * every interactive zsh BEFORE this rc. With ZDOTDIR pointed at our throwaway
 * temp dir, history was WRITTEN to the temp dir (deleted on session end) and
 * ~/.zsh_history was never LOADED — so up-arrow/fc/zsh-autosuggestions saw an
 * empty history. Unless the user's own config re-set HISTFILE, point it back at
 * the real one; default SAVEHIST/HISTSIZE only when still at zsh's built-in
 * no-persistence defaults (SAVEHIST=0 / HISTSIZE=30).
 */
export function zshInitScript(): string {
  return [
    '# Localix shell integration (OSC 133). Sources your real zsh config first,',
    '# in login-shell order.',
    '__lx_zdotdir="${LOCALIX_REAL_ZDOTDIR:-$HOME}"',
    '[ -f "$__lx_zdotdir/.zshenv" ] && source "$__lx_zdotdir/.zshenv"',
    '[ -f "$__lx_zdotdir/.zprofile" ] && source "$__lx_zdotdir/.zprofile"',
    '[ -f "$__lx_zdotdir/.zshrc" ] && source "$__lx_zdotdir/.zshrc"',
    '# History must live in the REAL home, not our temp ZDOTDIR (macOS /etc/zshrc',
    '# derives HISTFILE from ZDOTDIR) — otherwise it is thrown away on exit and',
    '# the existing ~/.zsh_history is never loaded.',
    'case "${HISTFILE:-}" in',
    '  ""|"$ZDOTDIR"|"$ZDOTDIR"/*) HISTFILE="$__lx_zdotdir/.zsh_history" ;;',
    'esac',
    '[ "${SAVEHIST:-0}" -gt 0 ] || SAVEHIST=2000',
    '[ "${HISTSIZE:-30}" -ne 30 ] || HISTSIZE=2000',
    '__lx_esc() { printf "\\033]133;%s\\007" "$1" }',
    '# B (input start) must fire where the INPUT begins — i.e. at the END of the',
    '# rendered prompt. precmd runs BEFORE the prompt paints, so emitting B there',
    '# would anchor the input column at 0 and the terminal client would read the',
    '# prompt text as typed input. Instead B rides as a zero-width %{..%} suffix',
    '# ON PROMPT itself, re-appended each precmd (themes rebuild PROMPT; our hook',
    '# runs after theirs since add-zsh-hook appends), never doubled.',
    '__lx_b_mark="%{$(printf "\\033]133;B\\007")%}"',
    '__lx_precmd() {',
    '  local ec=$?',
    '  __lx_esc "D;$ec"; __lx_esc "A"',
    '  case "$PROMPT" in',
    '    *"$__lx_b_mark") ;;',
    '    *) PROMPT="${PROMPT}${__lx_b_mark}" ;;',
    '  esac',
    '}',
    '__lx_preexec() { __lx_esc "C" }',
    'autoload -Uz add-zsh-hook 2>/dev/null',
    'if whence add-zsh-hook >/dev/null 2>&1; then',
    '  add-zsh-hook precmd __lx_precmd',
    '  add-zsh-hook preexec __lx_preexec',
    'fi',
    '# Login-order tail: a login zsh sources .zlogin after .zshrc.',
    '[ -f "$__lx_zdotdir/.zlogin" ] && source "$__lx_zdotdir/.zlogin"',
    'true',
    '',
  ].join('\n')
}

export interface ShellIntegrationInjection {
  /** Extra argv appended after the shell (e.g. `--rcfile <file>` for bash). */
  shellArgs: string[]
  /** Extra env layered over the shell's base environment (e.g. `ZDOTDIR`). */
  env: Record<string, string>
  /** Temp dir holding the generated rc; the caller removes it on dispose. */
  dir: string
}

/**
 * Write the rc script for the given shell to a fresh temp dir and return the
 * spawn injection. Returns `null` for an unsupported/unknown shell (→ plain
 * shell). Any fs failure propagates to the caller, which treats it as "no
 * integration" — keeping the whole thing opt-out safe.
 */
export function installShellIntegration(
  shellPath: string | undefined,
  opts?: { baseDir?: string },
): ShellIntegrationInjection | null {
  const kind = detectShellKind(shellPath)
  if (!kind) return null
  const dir = mkdtempSync(join(opts?.baseDir ?? tmpdir(), 'localix-si-'))
  if (kind === 'bash') {
    const rc = join(dir, 'bash-integration.sh')
    writeFileSync(rc, bashInitScript(), 'utf8')
    return { shellArgs: ['--rcfile', rc], env: {}, dir }
  }
  // zsh: override ZDOTDIR to our temp dir; remember the real one so our .zshrc
  // can re-source the user's config. Spawned as a LOGIN shell (`-l`) so the
  // system login files (/etc/zprofile → macOS path_helper, LANG) run exactly
  // like they do in a local terminal; the user's own .zprofile/.zlogin are
  // sourced by our .zshrc since the ZDOTDIR override hides them from zsh.
  writeFileSync(join(dir, '.zshrc'), zshInitScript(), 'utf8')
  const realZdotdir = process.env.ZDOTDIR || process.env.HOME || ''
  return { shellArgs: ['-l'], env: { ZDOTDIR: dir, LOCALIX_REAL_ZDOTDIR: realZdotdir }, dir }
}

/** Best-effort removal of the temp rc dir. Safe to call more than once. */
export function cleanupShellIntegration(dir: string | undefined): void {
  if (!dir) return
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* best-effort — a leaked temp dir is harmless */
  }
}
