FROM node:22-bullseye-slim AS node
FROM ubuntu:22.04

ARG RUNNER_VERSION=2.337.0
ARG RUNNER_SHA256=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613
ARG GH_VERSION=2.102.0
ARG GH_SHA256=bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git jq sudo unzip zip xz-utils zstd ripgrep zsh \
    build-essential file pkg-config libssl-dev libicu70 libkrb5-3 liblttng-ust1 \
    libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev xdg-utils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && curl -fsSL --retry 3 -o /tmp/gh.tar.gz \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    && echo "$GH_SHA256  /tmp/gh.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/gh.tar.gz -C /tmp \
    && install "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh \
    && rm -rf /tmp/gh*

RUN useradd --create-home --uid 1001 --shell /bin/bash runner \
    && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner \
    && chmod 440 /etc/sudoers.d/runner \
    && mkdir -p /opt/actions-runner /runner \
    && curl -fsSL --retry 3 -o /tmp/runner.tar.gz \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
    && echo "$RUNNER_SHA256  /tmp/runner.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/runner.tar.gz -C /opt/actions-runner \
    && cp /opt/actions-runner/bin/runsvc.sh /opt/actions-runner/runsvc.sh \
    && rm /tmp/runner.tar.gz \
    && chown -R runner:runner /opt/actions-runner /runner

USER runner
ENV PATH="/home/runner/.cargo/bin:/home/runner/.bun/bin:${PATH}" \
    CARGO_BUILD_JOBS=3 TURBO_CONCURRENCY=2
RUN curl -fsSL --retry 3 https://sh.rustup.rs -o /tmp/rustup.sh \
    && sh /tmp/rustup.sh -y --profile minimal --default-toolchain none \
    && rm /tmp/rustup.sh
WORKDIR /runner
CMD ["./runsvc.sh"]
