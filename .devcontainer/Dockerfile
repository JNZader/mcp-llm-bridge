ARG NODE_IMAGE
FROM ${NODE_IMAGE}

ARG NODE_IMAGE
ARG PNPM_VERSION=9.15.9

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN [[ "${NODE_IMAGE}" =~ ^node:22\.23\.2-bookworm@sha256:[0-9a-f]{64}$ ]] \
    || { printf '%s\n' 'NODE_IMAGE must be node:22.23.2-bookworm@sha256:<64 lowercase hex characters>.' >&2; exit 64; } \
 && [[ "$(node --version)" == "v22.23.2" ]] \
    || { printf '%s\n' 'The digest-pinned NODE_IMAGE does not provide Node v22.23.2.' >&2; exit 65; } \
 && [[ "$(node -p 'process.versions.modules')" == "127" ]] \
    || { printf '%s\n' 'The digest-pinned NODE_IMAGE does not provide ABI 127.' >&2; exit 66; }

RUN apt-get update \
 && apt-get install --yes --no-install-recommends g++ make python3 \
 && rm -rf /var/lib/apt/lists/* \
 && npm install --global "pnpm@${PNPM_VERSION}"

RUN mkdir -p /opt/mcp-llm-bridge-native \
 && chown -R node:node /opt/mcp-llm-bridge-native
WORKDIR /opt/mcp-llm-bridge-native

COPY package.json pnpm-lock.yaml ./
COPY .devcontainer/verify-native-binding.mjs ./verify-native-binding.mjs
COPY .devcontainer/seed-workspace-dependencies.sh ./seed-workspace-dependencies.sh

RUN pnpm install --frozen-lockfile \
 && pnpm rebuild better-sqlite3 \
 && node ./verify-native-binding.mjs --receipt ./native-binding-receipt.json \
 && chmod 0555 ./verify-native-binding.mjs ./seed-workspace-dependencies.sh \
 && chown -R root:root /opt/mcp-llm-bridge-native \
 && ln -s /opt/mcp-llm-bridge-native/seed-workspace-dependencies.sh /usr/local/bin/seed-workspace-dependencies.sh

RUN mkdir -p /workspace/node_modules \
 && chown node:node /workspace /workspace/node_modules

USER node
