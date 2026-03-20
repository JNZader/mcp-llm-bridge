FROM node:22-slim

# Force cache invalidation on each build
ARG CACHE_BUST=1

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

# Install all CLI tools via npm
# Claude Code (Max subscription), Gemini CLI (Google), Codex (OpenAI), Qwen, Copilot (GitHub)
RUN npm install -g \
      @anthropic-ai/claude-code \
      @google/gemini-cli \
      @openai/codex \
      @qwen-code/qwen-code \
      @github/copilot \
    2>&1 || true && \
    echo "=== CLI tools installed ===" && \
    (which claude && claude --version || echo "WARNING: claude not installed") && \
    (which gemini || echo "WARNING: gemini not installed") && \
    (which codex && codex --version || echo "WARNING: codex not installed") && \
    (which qwen && qwen --version || echo "WARNING: qwen not installed") && \
    (which copilot || echo "WARNING: copilot not installed")

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .

EXPOSE 3456
ENV LLM_GATEWAY_PORT=3456

CMD ["pnpm", "run", "serve"]
