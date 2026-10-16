# Localix Linux Actions runner

Linux CI, release verification, Linux desktop packaging, and landing deployment use the repository
runners sharing the label `localix-linux`. macOS packaging continues to use `macos-15`. Fork pull
requests use GitHub-hosted CI runners. Only trusted repository contributors should have permission
to change workflows or run code on this persistent runner.

The runner runs in an Ubuntu 22.04 container to preserve the Linux release's glibc baseline. It has
Node/npm, GitHub CLI, rustup, and native Tauri dependencies. Shared workflow actions pin Bun, Node,
and Rust. Each listener executes one job at a time. The first container has three CPUs and 6 GiB of
RAM; a second container uses its own runner volume and identity with four CPUs and 6 GiB of RAM.
Both have the same routing label, so two jobs can run concurrently. No host Docker socket, SSH keys,
or host home directory is mounted. Native dependencies are installed in the image; shared setup
skips repeated apt installs on self-hosted runners. Registration credentials live only in the runner
volume; never add them to the repository.

## Provision

Build on the Linux x64 host:

```bash
sudo docker build -t localix-actions-runner:latest scripts/actions-runner
sudo docker volume create localix-actions-runner
sudo docker run --rm --user root -v localix-actions-runner:/runner \
  localix-actions-runner:latest bash -c \
  'cp -a /opt/actions-runner/. /runner/ && chown -R runner:runner /runner'
```

Pipe a fresh repository registration token into configuration without putting it in the image, shell
history, or logs:

```bash
gh api --method POST repos/rsaryev/localix/actions/runners/registration-token --jq .token |
  sudo docker run --rm -i -v localix-actions-runner:/runner \
  localix-actions-runner:latest bash -c \
  'read -r token; ./config.sh --unattended --url https://github.com/rsaryev/localix \
    --token "$token" --name localix-linux --labels localix-linux --work _work'
sudo docker run -d --name localix-actions-runner --restart unless-stopped \
  --cpus 3 --memory 6g --memory-swap 8g --pids-limit 2048 \
  -v localix-actions-runner:/runner localix-actions-runner:latest
```

The runner auto-updates in its volume. Docker starts it after a host restart.

The second container's CPU limit can be adjusted without interrupting its job:

```bash
sudo docker update --cpus 4 --memory 6g --memory-swap 8g localix-actions-runner-2
```

## Verify and stop

```bash
gh api repos/rsaryev/localix/actions/runners \
  --jq '.runners[] | {name, status, busy, labels: [.labels[].name]}'
sudo docker logs --tail 30 localix-actions-runner
sudo docker exec localix-actions-runner bash -lc 'node --version; gh --version; rustup --version'
sudo docker stop localix-actions-runner
```

To roll back routing, restore the previous `runs-on` values in the three workflows before stopping
the container. Do not remove the volume during maintenance: it holds runner identity and workspaces.
To decommission, stop the container, remove the runner in repository Settings → Actions → Runners,
and then remove the container and volume.
