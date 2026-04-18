/**
 * PageIndex Module - Index barrel
 * 
 * Export all PageIndex components for easy importing
 */

export * from './types.js';
export * from './chunker.js';
export * from './database.js';
export * from './service.js';
export * from './tools.js';

// Main export for quick setup
import { PageIndexService } from './service.js';
import { PageIndexTools } from './tools.js';

export { PageIndexService, PageIndexTools };

/**
 * Quick setup function
 */
export function createPageIndex(dbPath?: string) {
  const service = new PageIndexService(dbPath);
  const tools = new PageIndexTools(service);
  
  return {
    service,
    tools,
    toolDefinitions: tools.getToolDefinitions(),
    handleToolCall: (name: string, args: any) => tools.handleToolCall(name, args)
  };
}
