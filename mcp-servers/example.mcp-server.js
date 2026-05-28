import { McpServerBuilder } from '../src/mcp-builder/index.js';

export default new McpServerBuilder()
  .tool('greet', 'Say hello to someone', { name: { type: 'string' } }, async ({ name }) => {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
  })
  .build();
