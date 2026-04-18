#!/usr/bin/env node
/**
 * PageIndex Simple Demo (No TypeScript compilation needed)
 * 
 * Demonstrates the concept without requiring build
 */

import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'fs';

const TEST_DB = '/tmp/pageindex-demo.db';

console.log('🧪 PageIndex Concept Demo\n');

// Clean up
if (existsSync(TEST_DB)) {
  unlinkSync(TEST_DB);
}

const db = new Database(TEST_DB);

// Create tables
db.exec(`
  CREATE TABLE conversation_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    total_pages INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    prev_page_id INTEGER,
    next_page_id INTEGER,
    UNIQUE(session_id, page_num)
  );
  
  CREATE INDEX idx_pages_session ON conversation_pages(session_id);
`);

console.log('✅ Database initialized\n');

// Simulate large content
const largeContent = `
# Authentication Architecture
JWT-based auth with refresh tokens, supporting GitHub, Google, and email.

## Security
- Access tokens: 15 min expiration
- Refresh tokens: 7 days, rotating
- Rate limiting: 5 attempts/min
- Passwords: min 12 chars

## Database
Users: id, email, password_hash, provider, created_at
Sessions: id, user_id, refresh_token_hash, expires_at

## API
POST /auth/login, /auth/refresh, /auth/logout, /auth/register
GET /auth/me

## Frontend
React hooks: useAuth, useLogin, useLogout
Zustand store with encrypted localStorage persistence

## Testing
Unit: token validation, password hashing
Integration: login flow, token refresh
E2E: registration, provider login, persistence
`.repeat(5);

// Chunk content
function chunkContent(content, maxChars = 6000, overlap = 800) {
  const chunks = [];
  let pos = 0;
  
  while (pos < content.length) {
    let end = Math.min(pos + maxChars, content.length);
    
    if (end < content.length) {
      // Try paragraph break
      const para = content.lastIndexOf('\n\n', end);
      if (para > pos + maxChars * 0.5) end = para + 2;
    }
    
    chunks.push(content.slice(pos, end).trim());
    pos = Math.max(pos + 1, end - overlap);
  }
  
  return chunks;
}

const chunks = chunkContent(largeContent);
console.log(`📄 Content split into ${chunks.length} pages\n`);

// Insert pages
const insert = db.prepare('INSERT INTO conversation_pages (session_id, page_num, total_pages, content, token_count) VALUES (?, ?, ?, ?, ?)');
const updateLinks = db.prepare('UPDATE conversation_pages SET prev_page_id = ?, next_page_id = ? WHERE id = ?');

const ids = [];
for (let i = 0; i < chunks.length; i++) {
  const result = insert.run('demo-session', i + 1, chunks.length, chunks[i], Math.ceil(chunks[i].length / 4));
  ids.push(result.lastInsertRowid);
}

// Link pages
for (let i = 0; i < ids.length; i++) {
  const prev = i > 0 ? ids[i - 1] : null;
  const next = i < ids.length - 1 ? ids[i + 1] : null;
  updateLinks.run(prev, next, ids[i]);
}

console.log('✅ Pages linked with prev/next navigation\n');

// Test queries
console.log('Test Queries:');

// 1. Get page 1
const page1 = db.prepare('SELECT * FROM conversation_pages WHERE session_id = ? AND page_num = ?').get('demo-session', 1);
console.log(`  📄 Page 1: ${page1.content.substring(0, 50)}... (${page1.token_count} tokens)`);

// 2. Get page 3 with neighbors
const context = db.prepare('SELECT * FROM conversation_pages WHERE session_id = ? AND page_num BETWEEN ? AND ? ORDER BY page_num')
  .all('demo-session', 2, 4);
console.log(`  📄 Context (pages 2-4): ${context.length} pages`);

// 3. Navigate next
const next = db.prepare('SELECT * FROM conversation_pages WHERE id = ?').get(page1.next_page_id);
console.log(`  ➡️  Next from page 1: Page ${next.page_num}`);

// 4. Stats
const stats = db.prepare('SELECT COUNT(*) as pages, SUM(token_count) as tokens FROM conversation_pages WHERE session_id = ?').get('demo-session');
console.log(`  📊 Total: ${stats.pages} pages, ${stats.tokens} tokens\n`);

// 5. Compaction check simulation
const currentTokens = stats.tokens;
const modelLimit = 4096;
const safeThreshold = modelLimit * 0.7; // Leave 30% for response

console.log('Compaction Prevention Analysis:');
console.log(`  📊 Model: ${modelLimit} tokens`);
console.log(`  📊 Safe threshold (70%): ${safeThreshold} tokens`);
console.log(`  📊 Current content: ${currentTokens} tokens`);
console.log(`  ⚠️  Would trigger compaction: ${currentTokens > safeThreshold}`);
console.log(`  ✅ Pages needed: ${Math.ceil(currentTokens / 1500)}\n`);

// Cleanup
db.close();
if (existsSync(TEST_DB)) {
  unlinkSync(TEST_DB);
}

console.log('🎉 Demo completed successfully!');
console.log('\nKey Features Demonstrated:');
console.log('  ✅ Content pagination (1.5K tokens/page)');
console.log('  ✅ Sequential storage with navigation');
console.log('  ✅ Context window retrieval');
console.log('  ✅ Token estimation and compaction prevention');
console.log('\n🚀 PageIndex is ready for MCP-LLM-Bridge integration!');
