// Bash command-safety classification: danger detection (rm -rf, sudo, dd, …) and
// read-only classification (what an `ask` rule judges a command by). Pure, side-effect-free,
// consumed by permission-engine.ts; extracted from bash.ts so the tool file owns
// execution and this one owns the static command analysis.

const DANGEROUS_PATTERNS = [
  // `rm` with BOTH recursive and force, in any form/order: combined (-rf/-fr),
  // separated (-r … -f), or long (--recursive … --force). The short-flag halves
  // use `(?<!-)` so they only match a single-dash flag — without it, `-[a-z]*r`
  // matches the `-for` inside `--force`, wrongly flagging a non-recursive
  // `rm --force file` as a dangerous recursive delete. Long forms stay explicit.
  /\brm\b(?=[^|&;\n]*(?:--recursive|(?<!-)-[a-z]*r))(?=[^|&;\n]*(?:--force|(?<!-)-[a-z]*f))/i,
  /\bsudo\b/,
  // Writing to a device file (e.g. > /dev/sda) can destroy a disk. The standard sink
  // pseudo-devices (null/stdout/stderr/tty) write nothing harmful, so exclude them.
  />\s*\/dev\/(?!null\b|stdout\b|stderr\b|tty\b)/,
  /\bdd\b.*\bif=/i,
  /\bmkfs\b/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /:\s*\(\)\s*\{.*\}.*:/,
  // Dangerous `git push` variants — IRREVERSIBLE damage to shared remote history:
  //   • `--force` / `-f` / `--force-with-lease` — rewrites remote history.
  //   • `--mirror` — force-overwrites ALL remote refs and DELETES any remote ref
  //     absent locally (a repo-wide overwrite, never a routine push).
  // Confirm even in auto/edit mode. `[^|&;\n]*` keeps the flag in the SAME segment
  // (so `git push … && rm -f x` doesn't cross-match), and the `(?<![-\w])` before
  // `-f`/`--force`/`--mirror` makes it a standalone flag, never the `-f` inside a
  // branch/remote name like `origin my-feature`.
  /\bgit\s+push\b[^|&;\n]*?(?<![-\w])(?:--force(?:-with-lease)?|--mirror|-f)\b/i,
  // A download piped straight into a shell interpreter (`curl … | bash`,
  // `wget … | sh`, optionally via `sudo`/`env`) — runs UNAUDITED remote code, the
  // canonical exfiltration/RCE vector. The interpreter must head the piped segment
  // so a benign `curl … | jq` / `… | grep sh` is not flagged.
  /\b(?:curl|wget|fetch)\b[^|;&]*\|\s*(?:sudo\s+|env\s+\S+\s+)*(?:ba|z|k|da)?sh\b/i,
  // Same download-to-code vector, but piped into a scripting-language interpreter
  // (`curl … | python3 -`, `wget … | perl`, `… | ruby|node`) instead of a shell.
  // Mirrors the shell rule: a downloader (curl/wget/fetch) must be UPSTREAM in the
  // pipeline and the interpreter must HEAD the piped segment (optionally via
  // `sudo`/`env`). The interpreter is only executing the DOWNLOAD when it reads
  // stdin as code — bare, with dash-flags, or `-` (optionally followed by argv
  // for the piped script). A script-FILE argument (`curl …json | python parse.py`,
  // `python -- local.py`) means the download is piped as DATA into a local,
  // auditable script, so it is NOT flagged (nor is `curl … | grep python`).
  // Lexical heuristic: quoting evasions (`python "-"`, `$'\x2d'`) are out of scope.
  /\b(?:curl|wget|fetch)\b[^|;&]*\|\s*(?:sudo\s+|env\s+\S+\s+)*\b(?:python3?|perl|ruby|node)\b(?:\s+-\S+)*(?:\s+-(?=[\s|;&]|$)[^|;&\n]*)?[^\S\n]*(?:[|;&\n]|$)/i,
  // A download run INSIDE a command substitution fed to a shell:
  // `sh -c "$(curl …)"` / `bash -c "$(wget …)"`. The `$( … )` runs the downloader
  // and its stdout becomes the script the shell executes — same unaudited-remote-
  // code vector, just spelled as substitution rather than a pipe. Requires a shell
  // invoked with a `-c` flag (alone OR clustered, e.g. `-lc`/`-xc`) AND a downloader
  // heading the `$( … )`, so `echo "$(curl …)"` (not a shell `-c`) and
  // `bash -c "$(cat local.sh)"` (no downloader) are NOT flagged. The flag cluster is
  // `(?<!-)-[a-z]*c[a-z]*` — a single-dash short-flag group containing `c` (so `-lc`,
  // `-cl`, `-xc` all match); the lookbehind keeps a long flag like `--config` out.
  /\b(?:ba|z|k|da)?sh\b\s+(?<!-)-[a-z]*c[a-z]*\b[^|;&\n]*\$\(\s*(?:sudo\s+|env\s+\S+\s+)*(?:curl|wget|fetch)\b/i,
  // Destructive Kubernetes verbs. Shell access is the generic route for these CLIs,
  // so the safety policy must classify their destructive forms directly. `delete`
  // and `drain` are the irreversible pair —
  // drain evicts every pod off a node. Read verbs (get/describe/logs) stay unflagged, or
  // ordinary investigation would prompt. `[^|&;\n]*` keeps the verb in the SAME segment.
  /\bkubectl\b[^|&;\n]*\b(?:delete|drain)\b/i,
  // Docker container/image/volume destruction and prunes. The `(?<![-\w])` guard
  // keeps the `--rm` of a routine `docker run --rm` out:
  // that flag cleans up the container the command itself just created.
  /\bdocker\b[^|&;\n]*(?<![-\w])\b(?:rmi|rm|prune)\b/i,
]

export function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command))
}

/**
 * The subset of `dangerous` that nobody can undo, at any price.
 *
 * `dangerous` is broad on purpose — `git push --force` and `docker rm` belong there, and both
 * are things a person does deliberately several times a week. This is the other end: wiping a
 * filesystem root or a home directory, formatting a device, writing an image onto a raw disk,
 * a fork bomb, powering the machine off. No backup makes those cheap, so they are worth
 * naming apart from "please confirm".
 *
 * It is VOCABULARY, not policy: nothing carries a rule about it by default, and what an
 * installation does with it — `ask`, `deny`, nothing — is its own decision. Every pattern
 * here also matches a `DANGEROUS_PATTERNS` entry, which its own test pins, so this can only
 * ever narrow: a `dangerous` rule still covers everything a `catastrophic` one would.
 */
const CATASTROPHIC_PATTERNS = [
  // `rm` recursive+force aimed at a ROOT rather than at a directory inside the work. The flag
  // halves mirror the `rm` entry above (either order, short or long); the target must be `/`,
  // a home, or one of the system children of `/`. `rm -rf /tmp/build` stays ordinary.
  /\brm\b(?=[^|&;\n]*(?:--recursive|(?<!-)-[a-z]*r))(?=[^|&;\n]*(?:--force|(?<!-)-[a-z]*f))[^|&;\n]*\s(?:\/|~|\$HOME|\/(?:usr|etc|var|bin|sbin|lib|boot|home|Users|System|Library))(?:\/\*)?(?:\s|$)/i,
  // Formatting a filesystem.
  /\bmkfs(?:\.\w+)?\b/i,
  // Writing an image straight onto a device node — `of=` is the half that destroys.
  /\bdd\b[^|&;\n]*\bof=\/dev\/(?!null\b|stdout\b|stderr\b|tty\b)/i,
  // The classic fork bomb, in its usual spelling.
  /:\s*\(\)\s*\{.*\}.*:/,
  // Powering the machine down takes the session with it, so nothing can report what happened.
  /\b(?:shutdown|reboot|halt|poweroff)\b/i,
]

/** Is this command irreversible? Always a subset of {@link isDangerous}. */
export function isCatastrophic(command: string): boolean {
  return CATASTROPHIC_PATTERNS.some((p) => p.test(command))
}
