/**
 * Balancer strategy tests — unit tests for each strategy implementation.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  RoundRobinBalancer,
  RandomBalancer,
  FailoverBalancer,
  WeightedBalancer,
  createBalancer,
  memberKey,
} from '../src/core/balancer.js';
import type { GroupMember } from '../src/core/groups.js';

// ── Test Fixtures ──────────────────────────────────────────

const MEMBERS: GroupMember[] = [
  { provider: 'openai', keyName: 'key-a', weight: 1, priority: 0 },
  { provider: 'anthropic', keyName: 'key-b', weight: 2, priority: 1 },
  { provider: 'google', keyName: 'key-c', weight: 1, priority: 2 },
];

// ── memberKey ──────────────────────────────────────────────

describe('memberKey', () => {
  it('builds provider:keyName key', () => {
    assert.equal(memberKey({ provider: 'openai', keyName: 'prod' }), 'openai:prod');
  });

  it('defaults keyName to "default"', () => {
    assert.equal(memberKey({ provider: 'openai' }), 'openai:default');
  });
});

// ── RoundRobinBalancer ─────────────────────────────────────

describe('RoundRobinBalancer', () => {
  let balancer: RoundRobinBalancer;

  beforeEach(() => {
    balancer = new RoundRobinBalancer();
  });

  it('has strategy "round-robin"', () => {
    assert.equal(balancer.strategy, 'round-robin');
  });

  it('cycles through members sequentially', () => {
    const results = [];
    for (let i = 0; i < 6; i++) {
      const member = balancer.next(MEMBERS);
      results.push(member?.provider);
    }
    assert.deepEqual(results, [
      'openai', 'anthropic', 'google',
      'openai', 'anthropic', 'google',
    ]);
  });

  it('skips excluded members', () => {
    const excluded = new Set(['openai:key-a']);
    const results = [];
    for (let i = 0; i < 4; i++) {
      const member = balancer.next(MEMBERS, excluded);
      results.push(member?.provider);
    }
    assert.deepEqual(results, ['anthropic', 'google', 'anthropic', 'google']);
  });

  it('returns null when all members are excluded', () => {
    const excluded = new Set(['openai:key-a', 'anthropic:key-b', 'google:key-c']);
    assert.equal(balancer.next(MEMBERS, excluded), null);
  });

  it('returns null for empty members', () => {
    assert.equal(balancer.next([]), null);
  });

  it('resets counter', () => {
    balancer.next(MEMBERS); // openai
    balancer.next(MEMBERS); // anthropic
    balancer.reset();
    const member = balancer.next(MEMBERS);
    assert.equal(member?.provider, 'openai');
  });
});

// ── RandomBalancer ─────────────────────────────────────────

describe('RandomBalancer', () => {
  let balancer: RandomBalancer;

  beforeEach(() => {
    balancer = new RandomBalancer();
  });

  it('has strategy "random"', () => {
    assert.equal(balancer.strategy, 'random');
  });

  it('returns a member from the pool', () => {
    const providerIds = MEMBERS.map((m) => m.provider);
    for (let i = 0; i < 20; i++) {
      const member = balancer.next(MEMBERS);
      assert.ok(member, 'Should return a member');
      assert.ok(providerIds.includes(member.provider), `Unexpected provider: ${member.provider}`);
    }
  });

  it('skips excluded members', () => {
    const excluded = new Set(['openai:key-a', 'google:key-c']);
    for (let i = 0; i < 20; i++) {
      const member = balancer.next(MEMBERS, excluded);
      assert.ok(member, 'Should return a member');
      assert.equal(member.provider, 'anthropic');
    }
  });

  it('returns null when all excluded', () => {
    const excluded = new Set(['openai:key-a', 'anthropic:key-b', 'google:key-c']);
    assert.equal(balancer.next(MEMBERS, excluded), null);
  });

  it('returns null for empty members', () => {
    assert.equal(balancer.next([]), null);
  });
});

// ── FailoverBalancer ───────────────────────────────────────

describe('FailoverBalancer', () => {
  let balancer: FailoverBalancer;

  beforeEach(() => {
    balancer = new FailoverBalancer();
  });

  it('has strategy "failover"', () => {
    assert.equal(balancer.strategy, 'failover');
  });

  it('always returns the first member (highest priority)', () => {
    for (let i = 0; i < 5; i++) {
      const member = balancer.next(MEMBERS);
      assert.equal(member?.provider, 'openai');
    }
  });

  it('sorts by priority field', () => {
    const members: GroupMember[] = [
      { provider: 'google', priority: 2 },
      { provider: 'openai', priority: 0 },
      { provider: 'anthropic', priority: 1 },
    ];
    const member = balancer.next(members);
    assert.equal(member?.provider, 'openai');
  });

  it('falls back when primary is excluded', () => {
    const excluded = new Set(['openai:key-a']);
    const member = balancer.next(MEMBERS, excluded);
    assert.equal(member?.provider, 'anthropic');
  });

  it('returns null when all excluded', () => {
    const excluded = new Set(['openai:key-a', 'anthropic:key-b', 'google:key-c']);
    assert.equal(balancer.next(MEMBERS, excluded), null);
  });
});

// ── WeightedBalancer ───────────────────────────────────────

describe('WeightedBalancer', () => {
  let balancer: WeightedBalancer;

  beforeEach(() => {
    balancer = new WeightedBalancer();
  });

  it('has strategy "weighted"', () => {
    assert.equal(balancer.strategy, 'weighted');
  });

  it('returns a member from the pool', () => {
    const providerIds = MEMBERS.map((m) => m.provider);
    for (let i = 0; i < 20; i++) {
      const member = balancer.next(MEMBERS);
      assert.ok(member, 'Should return a member');
      assert.ok(providerIds.includes(member.provider));
    }
  });

  it('respects weights (statistical test)', () => {
    // Anthropic has weight 2, others weight 1 → ~50% chance
    const counts = new Map<string, number>();
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const member = balancer.next(MEMBERS);
      assert.ok(member);
      const current = counts.get(member.provider) ?? 0;
      counts.set(member.provider, current + 1);
    }

    const anthropicCount = counts.get('anthropic') ?? 0;
    // Should be roughly 50% (500) with some variance
    // Accept 35%-65% range for statistical stability
    assert.ok(
      anthropicCount > 350 && anthropicCount < 650,
      `Expected ~500 anthropic selections, got ${anthropicCount}`,
    );
  });

  it('works with default weights (all equal)', () => {
    const members: GroupMember[] = [
      { provider: 'a' },
      { provider: 'b' },
    ];
    const providerIds = members.map((m) => m.provider);
    for (let i = 0; i < 20; i++) {
      const member = balancer.next(members);
      assert.ok(member);
      assert.ok(providerIds.includes(member.provider));
    }
  });

  it('returns null when all excluded', () => {
    const excluded = new Set(['openai:key-a', 'anthropic:key-b', 'google:key-c']);
    assert.equal(balancer.next(MEMBERS, excluded), null);
  });
});

// ── createBalancer factory ─────────────────────────────────

describe('createBalancer', () => {
  it('creates RoundRobinBalancer', () => {
    const b = createBalancer('round-robin');
    assert.equal(b.strategy, 'round-robin');
  });

  it('creates RandomBalancer', () => {
    const b = createBalancer('random');
    assert.equal(b.strategy, 'random');
  });

  it('creates FailoverBalancer', () => {
    const b = createBalancer('failover');
    assert.equal(b.strategy, 'failover');
  });

  it('creates WeightedBalancer', () => {
    const b = createBalancer('weighted');
    assert.equal(b.strategy, 'weighted');
  });
});
