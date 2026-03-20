FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9 --activate

# Install OpenCode CLI (direct binary — install script fails in slim containers)
ARG OPENCODE_VERSION=1.2.27
RUN curl -fsSL -o /tmp/opencode.tar.gz \
      "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64.tar.gz" && \
    tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin && \
    chmod +x /usr/local/bin/opencode && \
    rm -f /tmp/opencode.tar.gz && \
    echo "OpenCode installed: $(opencode --version)"

# Install Claude CLI (Claude Code) via npm for Max subscription support
RUN npm install -g @anthropic-ai/claude-code && \
    echo "Claude CLI installed: $(claude --version)"

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .

EXPOSE 3456
ENV LLM_GATEWAY_PORT=3456

CMD ["pnpm", "run", "serve"]
