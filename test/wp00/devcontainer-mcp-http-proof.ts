import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';

export const PROOF_VERSION = 'wp00-devcontainer-mcp-http-proof/v1';
export const APP_COMMAND = ['node', '--import', 'tsx', 'src/index.ts', '--http'] as const;
export const HEALTH_PORT = 43127;

const PROVIDER_ENVIRONMENT = [
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY',
  'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'MISTRAL_API_KEY',
  'CEREBRAS_API_KEY', 'SAMBANOVA_API_KEY', 'HYPERBOLIC_API_KEY', 'NVIDIA_API_KEY',
  'ZAI_API_KEY',
] as const;

export interface ProofReceipt {
  version: string;
  status: 'passed';
  mcp: { operation: 'tools/list'; toolCount: number };
  health: { operation: 'GET /health'; httpStatus: number; status: string };
  boundaries: readonly string[];
}

interface ProofClient {
  request(
    request: { method: 'tools/list'; params: Record<string, never> },
    resultSchema: typeof ListToolsResultSchema,
  ): Promise<{ tools?: readonly unknown[] }>;
  close(): Promise<void>;
}

export interface ProofDependencies {
  createClient: (env: Record<string, string>) => ProofClient;
  fetchHealth: (url: string) => Promise<{ status: number; json(): Promise<unknown> }>;
  env?: NodeJS.ProcessEnv;
}

export function buildProofEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {
    PATH: source.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: '/tmp/wp00-home',
    TMPDIR: '/tmp',
    NODE_ENV: 'test',
    LLM_GATEWAY_MASTER_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
    LLM_GATEWAY_DB_PATH: '/tmp/wp00-devcontainer-proof/vault.db',
    LLM_GATEWAY_PORT: String(HEALTH_PORT),
    LLM_GATEWAY_BIND_HOST: '127.0.0.1',
    LLM_GATEWAY_AUTH_REQUIRED: 'false',
    LLM_GATEWAY_SECURITY_PROFILE: 'local-dev',
    MCP_DYNAMIC_SERVERS: 'false',
    AUTO_DISCOVER_MODELS: 'false',
    MODEL_ROUTING_ENABLED: 'false',
    LATENCY_ROUTING: 'false',
    FREE_MODEL_CATALOG: 'false',
    FALLBACK_STRATEGY: 'none',
    LOCAL_LLM_ENABLED: 'false',
    ENABLE_TRACING: 'false',
    OTEL_SDK_DISABLED: 'true',
  };

  if (source.NODE_PATH) env.NODE_PATH = source.NODE_PATH;
  for (const name of PROVIDER_ENVIRONMENT) env[name] = '';
  return env;
}

export function createDefaultClient(env: Record<string, string>): ProofClient {
  const transport = new StdioClientTransport({
    command: APP_COMMAND[0],
    args: [...APP_COMMAND.slice(1)],
    env,
  });
  const client = new Client({ name: 'wp00-devcontainer-proof', version: PROOF_VERSION }, { capabilities: {} });
  let connected = false;
  return {
    async request(request, resultSchema) {
      if (!connected) {
        await client.connect(transport);
        connected = true;
      }
      return client.request(request, resultSchema);
    },
    close: () => client.close(),
  };
}

function parseHealth(value: unknown): { status: string } {
  if (typeof value !== 'object' || value === null || !('status' in value)) {
    throw new Error('Health response did not contain a status field');
  }
  const status = value.status;
  if (typeof status !== 'string') throw new Error('Health status was not a string');
  return { status };
}

export async function runProof(dependencies: ProofDependencies): Promise<ProofReceipt> {
  const env = buildProofEnvironment(dependencies.env);
  const client = dependencies.createClient(env);
  try {
    const tools = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema);
    const response = await dependencies.fetchHealth(`http://127.0.0.1:${HEALTH_PORT}/health`);
    const health = parseHealth(await response.json());
    if (response.status !== 200 || health.status !== 'ok') {
      throw new Error(`Health check failed with HTTP ${response.status}`);
    }
    return {
      version: PROOF_VERSION,
      status: 'passed',
      mcp: { operation: 'tools/list', toolCount: tools.tools?.length ?? 0 },
      health: { operation: 'GET /health', httpStatus: response.status, status: health.status },
      boundaries: [
        'MCP tools/list and loopback /health only',
        'No provider or generation readiness claim',
        'No MCP tool invocation',
      ],
    };
  } finally {
    await client.close();
  }
}

export async function main(): Promise<void> {
  const receipt = await runProof({
    createClient: createDefaultClient,
    fetchHealth: async (url) => fetch(url),
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1]?.endsWith('devcontainer-mcp-http-proof.ts')) {
  await main();
}
