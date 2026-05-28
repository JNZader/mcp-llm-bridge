/**
 * TDD Tests for Load Balancer Strategies
 *
 * Feature 7: 4 Load Balancing Modes
 * Following Red → Green → Refactor cycle
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LoadBalancer,
  LOAD_BALANCE_MODE,
  ProviderCandidate,
  RoundRobinStrategy,
  RandomStrategy,
  FailoverStrategy,
  WeightedStrategy,
  createStrategy,
  getStrategyDescription,
  isLoadBalanceMode,
} from '../../src/balancer/index.js';

describe('LoadBalancer', () => {
  describe('ROUND_ROBIN', () => {
    it('should cycle through candidates', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.ROUND_ROBIN);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', healthy: true },
        { id: 'c', provider: 'p3', keyId: 'k3', model: 'm1', healthy: true },
      ];

      const results = [
        balancer.select(candidates),
        balancer.select(candidates),
        balancer.select(candidates),
        balancer.select(candidates),
      ];

      assert.strictEqual(results[0]?.id, 'a');
      assert.strictEqual(results[1]?.id, 'b');
      assert.strictEqual(results[2]?.id, 'c');
      assert.strictEqual(results[3]?.id, 'a'); // cycles back
    });

    it('should reset counter on mode switch', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.ROUND_ROBIN);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', healthy: true },
      ];

      // Advance counter
      balancer.select(candidates);
      balancer.select(candidates);

      // Switch away and back
      balancer.setMode(LOAD_BALANCE_MODE.RANDOM);
      balancer.setMode(LOAD_BALANCE_MODE.ROUND_ROBIN);

      // Should start from beginning again
      const result = balancer.select(candidates);
      assert.strictEqual(result?.id, 'a');
    });
  });

  describe('RANDOM', () => {
    it('should select candidates', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.RANDOM);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', healthy: true },
      ];

      // Run multiple times, verify both get selected eventually
      const selections = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const result = balancer.select(candidates);
        if (result) selections.add(result.id);
      }

      assert.ok(selections.has('a'));
      assert.ok(selections.has('b'));
    });

    it('should select from single candidate', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.RANDOM);
      const candidates: ProviderCandidate[] = [
        { id: 'only', provider: 'p1', keyId: 'k1', model: 'm1', healthy: true },
      ];

      const result = balancer.select(candidates);
      assert.strictEqual(result?.id, 'only');
    });
  });

  describe('FAILOVER', () => {
    it('should select by priority (lowest first)', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.FAILOVER);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', priority: 2, healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', priority: 1, healthy: true },
        { id: 'c', provider: 'p3', keyId: 'k3', model: 'm1', priority: 3, healthy: true },
      ];

      const result = balancer.select(candidates);
      assert.strictEqual(result?.id, 'b'); // lowest priority number
    });

    it('should skip unhealthy candidates', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.FAILOVER);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', priority: 1, healthy: false },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', priority: 2, healthy: true },
      ];

      const result = balancer.select(candidates);
      assert.strictEqual(result?.id, 'b');
    });

    it('should fallback to higher priority when lower is unhealthy', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.FAILOVER);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', priority: 1, healthy: false },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', priority: 2, healthy: false },
        { id: 'c', provider: 'p3', keyId: 'k3', model: 'm1', priority: 3, healthy: true },
      ];

      const result = balancer.select(candidates);
      assert.strictEqual(result?.id, 'c');
    });

    it('should treat undefined priority as lowest (999)', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.FAILOVER);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', priority: 1, healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', healthy: true }, // no priority
      ];

      const result = balancer.select(candidates);
      assert.strictEqual(result?.id, 'a'); // b has priority 999 (lowest)
    });

    it('should return null when all unhealthy', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.FAILOVER);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', priority: 1, healthy: false },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', priority: 2, healthy: false },
      ];

      const result = balancer.select(candidates);
      assert.strictEqual(result, null);
    });
  });

  describe('WEIGHTED', () => {
    it('should select by weight distribution', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.WEIGHTED);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', weight: 3, healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', weight: 1, healthy: true },
      ];

      // Run 400 times, expect roughly 300:100 ratio
      let countA = 0, countB = 0;
      for (let i = 0; i < 400; i++) {
        const result = balancer.select(candidates);
        if (result?.id === 'a') countA++;
        else if (result?.id === 'b') countB++;
      }

      // Allow 30% tolerance (statistical variance)
      assert.ok(countA > 180, `Expected countA > 180, got ${countA}`);
      assert.ok(countB > 30, `Expected countB > 30, got ${countB}`);
    });

    it('should use default weight of 1 when not specified', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.WEIGHTED);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', healthy: true }, // weight 1
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', healthy: true }, // weight 1
      ];

      // With equal weights, should get roughly 50/50
      let countA = 0;
      for (let i = 0; i < 200; i++) {
        const result = balancer.select(candidates);
        if (result?.id === 'a') countA++;
      }

      // Should be roughly 50% with tolerance
      assert.ok(countA > 60, `Expected countA > 60, got ${countA}`);
      assert.ok(countA < 140, `Expected countA < 140, got ${countA}`);
    });

    it('should handle zero weight candidates', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.WEIGHTED);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', weight: 0, healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', weight: 1, healthy: true },
      ];

      // b should almost always be selected
      let countB = 0;
      for (let i = 0; i < 100; i++) {
        const result = balancer.select(candidates);
        if (result?.id === 'b') countB++;
      }

      assert.strictEqual(countB, 100);
    });
  });

  describe('General Behavior', () => {
    it('should return null for empty candidates', () => {
      const balancer = new LoadBalancer();
      const result = balancer.select([]);
      assert.strictEqual(result, null);
    });

    it('should filter to healthy candidates only', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.RANDOM);
      const candidates: ProviderCandidate[] = [
        { id: 'unhealthy1', provider: 'p1', keyId: 'k1', model: 'm1', healthy: false },
        { id: 'unhealthy2', provider: 'p2', keyId: 'k2', model: 'm1', healthy: false },
        { id: 'healthy', provider: 'p3', keyId: 'k3', model: 'm1', healthy: true },
      ];

      // Should only ever select the healthy one
      for (let i = 0; i < 50; i++) {
        const result = balancer.select(candidates);
        assert.strictEqual(result?.id, 'healthy');
      }
    });

    it('should return null when all candidates unhealthy', () => {
      const balancer = new LoadBalancer();
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', healthy: false },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', healthy: false },
      ];

      const result = balancer.select(candidates);
      assert.strictEqual(result, null);
    });

    it('should switch modes dynamically', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.ROUND_ROBIN);
      assert.strictEqual(balancer.getMode(), LOAD_BALANCE_MODE.ROUND_ROBIN);

      balancer.setMode(LOAD_BALANCE_MODE.RANDOM);
      assert.strictEqual(balancer.getMode(), LOAD_BALANCE_MODE.RANDOM);
    });

    it('should get available modes', () => {
      const balancer = new LoadBalancer();
      const modes = balancer.getAvailableModes();

      assert.ok(modes.includes(LOAD_BALANCE_MODE.ROUND_ROBIN));
      assert.ok(modes.includes(LOAD_BALANCE_MODE.RANDOM));
      assert.ok(modes.includes(LOAD_BALANCE_MODE.FAILOVER));
      assert.ok(modes.includes(LOAD_BALANCE_MODE.WEIGHTED));
      assert.strictEqual(modes.length, 4);
    });

    it('should check if mode is supported', () => {
      const balancer = new LoadBalancer();

      assert.strictEqual(balancer.isModeSupported('round_robin'), true);
      assert.strictEqual(balancer.isModeSupported('random'), true);
      assert.strictEqual(balancer.isModeSupported('failover'), true);
      assert.strictEqual(balancer.isModeSupported('weighted'), true);
      assert.strictEqual(balancer.isModeSupported('invalid'), false);
      assert.strictEqual(balancer.isModeSupported(''), false);
    });

    it('should provide selection details', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.ROUND_ROBIN);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', healthy: true },
      ];

      const result = balancer.selectWithDetails(candidates);

      assert.notStrictEqual(result, null);
      assert.strictEqual(result?.candidate.id, 'a');
      assert.strictEqual(result?.strategy, LOAD_BALANCE_MODE.ROUND_ROBIN);
      assert.ok(result?.timestamp && result.timestamp > 0);
    });

    it('should update configuration', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.ROUND_ROBIN, { maxRetries: 5 });

      balancer.updateConfig({ maxRetries: 10 });

      const config = balancer.getConfig();
      assert.strictEqual(config.maxRetries, 10);
      assert.strictEqual(config.mode, LOAD_BALANCE_MODE.ROUND_ROBIN);
    });

    it('should handle mode change via updateConfig', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.ROUND_ROBIN);

      balancer.updateConfig({ mode: LOAD_BALANCE_MODE.RANDOM });

      assert.strictEqual(balancer.getMode(), LOAD_BALANCE_MODE.RANDOM);
      assert.strictEqual(balancer.getConfig().mode, LOAD_BALANCE_MODE.RANDOM);
    });
  });
});

describe('Strategy Classes', () => {
  describe('RoundRobinStrategy', () => {
    it('should cycle through candidates', () => {
      const strategy = new RoundRobinStrategy();
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', healthy: true },
      ];

      assert.strictEqual(strategy.select(candidates)?.id, 'a');
      assert.strictEqual(strategy.select(candidates)?.id, 'b');
      assert.strictEqual(strategy.select(candidates)?.id, 'a');
    });

    it('should reset counter', () => {
      const strategy = new RoundRobinStrategy();
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', healthy: true },
      ];

      strategy.select(candidates);
      strategy.select(candidates);
      strategy.reset();

      assert.strictEqual(strategy.select(candidates)?.id, 'a');
    });

    it('should return null for empty array', () => {
      const strategy = new RoundRobinStrategy();
      assert.strictEqual(strategy.select([]), null);
    });
  });

  describe('RandomStrategy', () => {
    it('should select from candidates', () => {
      const strategy = new RandomStrategy();
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', healthy: true },
      ];

      const selections = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const result = strategy.select(candidates);
        if (result) selections.add(result.id);
      }

      assert.ok(selections.has('a'));
      assert.ok(selections.has('b'));
    });

    it('should return null for empty array', () => {
      const strategy = new RandomStrategy();
      assert.strictEqual(strategy.select([]), null);
    });
  });

  describe('FailoverStrategy', () => {
    it('should select lowest priority', () => {
      const strategy = new FailoverStrategy();
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', priority: 2, healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', priority: 1, healthy: true },
      ];

      assert.strictEqual(strategy.select(candidates)?.id, 'b');
    });

    it('should return null for empty array', () => {
      const strategy = new FailoverStrategy();
      assert.strictEqual(strategy.select([]), null);
    });
  });

  describe('WeightedStrategy', () => {
    it('should distribute by weight', () => {
      const strategy = new WeightedStrategy();
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', weight: 3, healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', weight: 1, healthy: true },
      ];

      let countA = 0;
      for (let i = 0; i < 400; i++) {
        const result = strategy.select(candidates);
        if (result?.id === 'a') countA++;
      }

      assert.ok(countA > 180, `Expected countA > 180, got ${countA}`);
    });

    it('should return null for empty array', () => {
      const strategy = new WeightedStrategy();
      assert.strictEqual(strategy.select([]), null);
    });
  });
});

describe('createStrategy', () => {
  it('should create RoundRobinStrategy', () => {
    const strategy = createStrategy(LOAD_BALANCE_MODE.ROUND_ROBIN);
    assert.ok(strategy instanceof RoundRobinStrategy);
  });

  it('should create RandomStrategy', () => {
    const strategy = createStrategy(LOAD_BALANCE_MODE.RANDOM);
    assert.ok(strategy instanceof RandomStrategy);
  });

  it('should create FailoverStrategy', () => {
    const strategy = createStrategy(LOAD_BALANCE_MODE.FAILOVER);
    assert.ok(strategy instanceof FailoverStrategy);
  });

  it('should create WeightedStrategy', () => {
    const strategy = createStrategy(LOAD_BALANCE_MODE.WEIGHTED);
    assert.ok(strategy instanceof WeightedStrategy);
  });

  it('should throw for invalid mode', () => {
    assert.throws(
      () => createStrategy('invalid' as any),
      /Unknown load balance mode/
    );
  });
});

describe('getStrategyDescription', () => {
  it('should describe round_robin', () => {
    const desc = getStrategyDescription(LOAD_BALANCE_MODE.ROUND_ROBIN);
    assert.ok(desc.includes('sequentially'));
  });

  it('should describe random', () => {
    const desc = getStrategyDescription(LOAD_BALANCE_MODE.RANDOM);
    assert.ok(desc.includes('Randomly'));
  });

  it('should describe failover', () => {
    const desc = getStrategyDescription(LOAD_BALANCE_MODE.FAILOVER);
    assert.ok(desc.includes('priority'));
  });

  it('should describe weighted', () => {
    const desc = getStrategyDescription(LOAD_BALANCE_MODE.WEIGHTED);
    assert.ok(desc.includes('weight'));
  });
});

describe('isLoadBalanceMode', () => {
  it('should validate valid modes', () => {
    assert.strictEqual(isLoadBalanceMode('round_robin'), true);
    assert.strictEqual(isLoadBalanceMode('random'), true);
    assert.strictEqual(isLoadBalanceMode('failover'), true);
    assert.strictEqual(isLoadBalanceMode('weighted'), true);
  });

  it('should reject invalid modes', () => {
    assert.strictEqual(isLoadBalanceMode('invalid'), false);
    assert.strictEqual(isLoadBalanceMode(''), false);
    assert.strictEqual(isLoadBalanceMode(null as any), false);
    assert.strictEqual(isLoadBalanceMode(undefined as any), false);
    assert.strictEqual(isLoadBalanceMode(123 as any), false);
  });
});
