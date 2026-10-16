/** Top-level `localix --help` text. The command opens a path in the desktop app;
 *  it never boots a server and never renders a session itself
 *  (see docs/features/cli.md). */
export function printHelp(): void {
  process.stdout.write(
    [
      '',
      '  localix — open a folder or file in the Localix desktop app',
      '',
      '  Usage',
      '    localix                Open the current directory as a project',
      '    localix <path>         Open a directory as a project, or a file in an editor tab',
      '    localix open [path]    The same, named explicitly (no path = the current directory)',
      '    localix help           Print this help',
      '',
      '  Options',
      '    -n, --new           Force a fresh project/session for the path',
      '    -h, --help          Show this help',
      '    -v, --version       Print the version and exit',
      '',
      '  The path is handed to the RUNNING desktop app over the `localix://` handler',
      '  (install the launcher from Settings → General → Command line).',
      '',
    ].join('\n') + '\n',
  )
}
