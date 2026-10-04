// GNU coreutils `timeout` is absent on stock macOS, yet models routinely reach
// for `timeout <secs> <cmd>` to cap a command — and `cd x && timeout 3 npm run dev`
// then dies with a confusing "command not found", burning a whole turn + a full
// context replay. When a command uses `timeout` as a command word, prepend a
// guarded POSIX shim: the function is defined ONLY when the real binary is missing
// (`command -v timeout || …`), so a present GNU timeout (Linux ssh/docker backends,
// macOS coreutils) is never shadowed and keeps its full flag set. Plain
// `timeout <secs> <cmd>` — the only form seen in practice — is emulated; flag forms
// (`timeout -k …`) fall through to the absent binary exactly as before.
const TIMEOUT_SHIM =
  'command -v timeout >/dev/null 2>&1 || timeout(){ __d=${1%s}; shift; "$@" & __p=$!; ( sleep "$__d"; kill -TERM $__p 2>/dev/null ) & __w=$!; wait $__p 2>/dev/null; __r=$?; kill $__w 2>/dev/null; return $__r; }; '

// `timeout` as a command word followed by a numeric duration: at the start, or
// after a shell separator. Excludes substrings like `--timeout`/`mytimeout`.
const TIMEOUT_WORD = /(?:^|[\s;&|(])timeout\s+\d/

/** Prepend the `timeout` shim when (and only when) the command would invoke it. */
export function withTimeoutShim(command: string): string {
  return TIMEOUT_WORD.test(command) ? TIMEOUT_SHIM + command : command
}

// Stock macOS ships only `python3`, no `python` — yet models routinely run
// `python -m pytest` / `python script.py`, which dies with "command not found",
// burning a turn + a full context replay (measured: the top recurring failedCmd in
// unattended delegated task runs, where it also wastes an attempt). Same guarded-shim
// approach as timeout: define `python` as a thin `python3` wrapper ONLY when no real
// `python` binary exists (`command -v python || …`), so a present python (Linux,
// pyenv, venv) is never shadowed. python2 is EOL and absent on modern systems, so
// the only realistic missing-binary case maps to python3.
const PYTHON_SHIM = 'command -v python >/dev/null 2>&1 || python(){ python3 "$@"; }; '
// `python` as a command word (start or after a separator) followed by whitespace —
// matches `python -m pytest`, excludes `python3`/`python2` (next char is a digit),
// `ipython`/`mypython` (preceded by a word char), and `python.py`/`python-foo` args.
const PYTHON_WORD = /(?:^|[\s;&|(])python\s/

/** Prepend the `python`→`python3` shim when (and only when) the command invokes `python`. */
export function withPythonShim(command: string): string {
  return PYTHON_WORD.test(command) ? PYTHON_SHIM + command : command
}

/** Apply all command shims (timeout + python) a model commonly trips over on macOS. */
export function withCommandShims(command: string): string {
  return withTimeoutShim(withPythonShim(command))
}
