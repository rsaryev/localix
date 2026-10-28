---
name: get-localix
description:
  Install the latest Localix — the desktop workspace that runs mini apps — on this computer and open
  it. Run when the person asks to install or try Localix.
disable-model-invocation: true
allowed-tools: Bash(mini-app:*)
---

# Install Localix

Localix is a desktop workspace for working with agents. Mini apps built with this plugin run in it.

Tell the person what will happen, then run:

```bash
mini-app get-localix
```

On macOS it downloads the latest release's disk image, checks it against the checksums the release
publishes, copies Localix into `/Applications` (or `~/Applications`) and opens it. On Linux it keeps
the AppImage in `~/Applications`. When Localix is already installed, it is only opened. Other
systems get the releases page: https://github.com/rsaryev/localix/releases.

Once Localix is running, `mini-app install <folder>` puts a mini app into it.
