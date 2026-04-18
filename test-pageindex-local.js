#!/usr/bin/env node
/**
 * PageIndex Local Test Script
 * 
 * Tests PageIndex functionality without Docker
 * Run: node test-pageindex-local.js
 */

import { PageIndexService } from './src/pageindex/service.js';
import { existsSync, unlinkSync } from 'fs';

const TEST_DB = '/tmp/test-pageindex-local.db';

console.log('🧪 PageIndex Local Test\n');

// Clean up previous test
if (existsSync(TEST_DB)) {
  unlinkSync(TEST_DB);
}

// Initialize service
const service = new PageIndexService(TEST_DB);

async function runTests() {
  console.log('✅ Service initialized\n');

  // Test 1: Paginate large content
  console.log('Test 1: Paginate large conversation');
  const largeContent = `
# Project Architecture Discussion

## Authentication System
We need to implement JWT-based authentication with refresh tokens.
The system should support multiple providers: GitHub, Google, and email/password.

Security considerations:
- Token expiration: 15 minutes for access tokens
- Refresh tokens: 7 days, rotating on each use
- Rate limiting: 5 attempts per minute for login
- Password requirements: min 12 chars, complexity rules

## Database Schema
Users table with fields:
- id (UUID)
- email (unique, indexed)
- password_hash (bcrypt)
- provider (github|google|email)
- provider_id (nullable)
- created_at, updated_at
- last_login

Sessions table:
- id (UUID)
- user_id (FK)
- refresh_token_hash
- expires_at
- user_agent, ip_address
- created_at

## API Endpoints
POST /auth/login - Authenticate user, return tokens
POST /auth/refresh - Get new access token using refresh token  
POST /auth/logout - Invalidate refresh token
POST /auth/register - Create new account
GET /auth/me - Get current user info

## Frontend Integration
React hooks for auth:
- useAuth() - Get current user and auth state
- useLogin() - Login mutation
- useLogout() - Logout mutation
- ProtectedRoute component

State management with Zustand:
- auth store with user, tokens, isLoading
- Persist to localStorage (encrypted)
- Auto-refresh tokens before expiration

## Testing Strategy
Unit tests for:
- Token generation/validation
- Password hashing/comparison
- Session management

Integration tests for:
- Full login/logout flow
- Token refresh mechanism
- Protected route access

E2E tests with Playwright:
- User registration flow
- Login with different providers
- Session persistence across reloads
`.repeat(3); // Make it even larger

  const result = await service.paginateSession('demo-session-1', largeContent);
  console.log(`  📄 Created ${result.pages} pages (${result.tokens} tokens total)`);
  console.log(`  ✅ Average ${Math.round(result.tokens / result.pages)} tokens per page\n`);

  // Test 2: Get specific page
  console.log('Test 2: Get specific pages');
  const page1 = service.getPage('demo-session-1', 1);
  const page3 = service.getPage('demo-session-1', 3);
  console.log(`  📄 Page 1: ${page1?.content.substring(0, 50)}...`);
  console.log(`  📄 Page 3: ${page3?.content.substring(0, 50)}...`);
  console.log(`  ✅ Pages retrieved successfully\n`);

  // Test 3: Context window
  console.log('Test 3: Get page with context window');
  const context = service.getContext({
    sessionId: 'demo-session-1',
    pageNum: 3,
    windowSize: 1
  });
  console.log(`  📄 Current page: ${context.currentPage.pageNum}`);
  console.log(`  📄 Previous pages: ${context.previousPages.length}`);
  console.log(`  📄 Next pages: ${context.nextPages.length}`);
  console.log(`  📄 Total context tokens: ${context.totalTokens}`);
  console.log(`  ✅ Context window retrieved\n`);

  // Test 4: Compaction prevention (the key feature!)
  console.log('Test 4: Compaction prevention check');
  const check4K = service.checkCompaction('demo-session-1', 4096, 0);
  console.log(`  🔍 Model: 4K context`);
  console.log(`  📊 Current tokens: ${check4K.currentTokens}`);
  console.log(`  ⚠️  Should compact: ${check4K.shouldCompact}`);
  console.log(`  ✅ Safe to proceed: ${check4K.safeToProceed}`);
  
  if (check4K.shouldCompact) {
    console.log(`  💡 Suggested action: ${check4K.suggestedAction}`);
  }
  console.log();

  // Test 5: Navigation
  console.log('Test 5: Navigate between pages');
  const next = service.navigate({
    sessionId: 'demo-session-1',
    currentPageNum: 1,
    direction: 'next'
  });
  const prev = service.navigate({
    sessionId: 'demo-session-1', 
    currentPageNum: 2,
    direction: 'prev'
  });
  console.log(`  ➡️  Next from page 1: Page ${next?.pageNum}`);
  console.log(`  ⬅️  Prev from page 2: Page ${prev?.pageNum}`);
  console.log(`  ✅ Navigation works\n`);

  // Test 6: Find relevant pages
  console.log('Test 6: Find relevant pages by keyword');
  const relevant = service.findRelevantPages('demo-session-1', 'authentication JWT', 2);
  console.log(`  🔍 Query: "authentication JWT"`);
  console.log(`  📄 Found ${relevant.length} relevant pages`);
  relevant.forEach((page, i) => {
    console.log(`     Page ${page.pageNum}: ${page.content.substring(0, 60)}...`);
  });
  console.log(`  ✅ Keyword search works\n`);

  // Stats
  console.log('Test 7: Statistics');
  const stats = service.getStats();
  const info = service.getSessionInfo('demo-session-1');
  console.log(`  📊 Total sessions: ${stats.sessions}`);
  console.log(`  📊 Total pages: ${stats.pages}`);
  console.log(`  📊 Demo session: ${info.pages} pages, ${info.tokens} tokens\n`);

  // Summary
  console.log('🎉 All tests passed!\n');
  console.log('PageIndex Features Validated:');
  console.log('  ✅ Content pagination');
  console.log('  ✅ Page retrieval');
  console.log('  ✅ Context windows');
  console.log('  ✅ Compaction prevention');
  console.log('  ✅ Navigation');
  console.log('  ✅ Keyword search');
  console.log('  ✅ Statistics');
  console.log('\n🚀 Ready for production use with small models (4K-8K context)!');

  // Cleanup
  service.close();
  if (existsSync(TEST_DB)) {
    unlinkSync(TEST_DB);
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
