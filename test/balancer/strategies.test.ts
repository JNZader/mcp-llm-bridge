/**
 * TDD Tests for Load Balancer Strategies
 *
 * Feature 7: 4 Load Balancing Modes
 * Following Red → Green → Refactor cycle
 */

import { describe, it, expect } from 'vitest';
import {
  LoadBalancer,
  LoadBalanceMode,
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

      expect(results[0]?.id).toBe('a');
      expect(results[1]?.id).toBe('b');
      expect(results[2]?.id).toBe('c');
      expect(results[3]?.id).toBe('a'); // cycles back
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
      expect(result?.id).toBe('a');
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

      expect(selections.has('a')).toBe(true);
      expect(selections.has('b')).toBe(true);
    });

    it('should select from single candidate', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.RANDOM);
      const candidates: ProviderCandidate[] = [
        { id: 'only', provider: 'p1', keyId: 'k1', model: 'm1', healthy: true },
      ];

      const result = balancer.select(candidates);
      expect(result?.id).toBe('only');
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
      expect(result?.id).toBe('b'); // lowest priority number
    });

    it('should skip unhealthy candidates', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.FAILOVER);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', priority: 1, healthy: false },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', priority: 2, healthy: true },
      ];

      const result = balancer.select(candidates);
      expect(result?.id).toBe('b');
    });

    it('should fallback to higher priority when lower is unhealthy', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.FAILOVER);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', priority: 1, healthy: false },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', priority: 2, healthy: false },
        { id: 'c', provider: 'p3', keyId: 'k3', model: 'm1', priority: 3, healthy: true },
      ];

      const result = balancer.select(candidates);
      expect(result?.id).toBe('c');
    });

    it('should treat undefined priority as lowest (999)', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.FAILOVER);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', priority: 1, healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', healthy: true }, // no priority
      ];

      const result = balancer.select(candidates);
      expect(result?.id).toBe('a'); // b has priority 999 (lowest)
    });

    it('should return null when all unhealthy', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.FAILOVER);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', priority: 1, healthy: false },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', priority: 2, healthy: false },
      ];

      const result = balancer.select(candidates);
      expect(result).toBeNull();
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
      expect(countA).toBeGreaterThan(180);
      expect(countB).toBeGreaterThan(30);
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
      expect(countA).toBeGreaterThan(60);
      expect(countA).toBeLessThan(140);
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

      expect(countB).toBe(100);
    });
  });

  describe('General Behavior', () => {
    it('should return null for empty candidates', () => {
      const balancer = new LoadBalancer();
      const result = balancer.select([]);
      expect(result).toBeNull();
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
        expect(result?.id).toBe('healthy');
      }
    });

    it('should return null when all candidates unhealthy', () => {
      const balancer = new LoadBalancer();
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', healthy: false },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', healthy: false },
      ];

      const result = balancer.select(candidates);
      expect(result).toBeNull();
    });

    it('should switch modes dynamically', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.ROUND_ROBIN);
      expect(balancer.getMode()).toBe(LOAD_BALANCE_MODE.ROUND_ROBIN);

      balancer.setMode(LOAD_BALANCE_MODE.RANDOM);
      expect(balancer.getMode()).toBe(LOAD_BALANCE_MODE.RANDOM);
    });

    it('should get available modes', () => {
      const balancer = new LoadBalancer();
      const modes = balancer.getAvailableModes();

      expect(modes).toContain(LOAD_BALANCE_MODE.ROUND_ROBIN);
      expect(modes).toContain(LOAD_BALANCE_MODE.RANDOM);
      expect(modes).toContain(LOAD_BALANCE_MODE.FAILOVER);
      expect(modes).toContain(LOAD_BALANCE_MODE.WEIGHTED);
      expect(modes).toHaveLength(4);
    });

    it('should check if mode is supported', () => {
      const balancer = new LoadBalancer();

      expect(balancer.isModeSupported('round_robin')).toBe(true);
      expect(balancer.isModeSupported('random')).toBe(true);
      expect(balancer.isModeSupported('failover')).toBe(true);
      expect(balancer.isModeSupported('weighted')).toBe(true);
      expect(balancer.isModeSupported('invalid')).toBe(false);
      expect(balancer.isModeSupported('')).toBe(false);
    });

    it('should provide selection details', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.ROUND_ROBIN);
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', healthy: true },
      ];

      const result = balancer.selectWithDetails(candidates);

      expect(result).not.toBeNull();
      expect(result?.candidate.id).toBe('a');
      expect(result?.strategy).toBe(LOAD_BALANCE_MODE.ROUND_ROBIN);
      expect(result?.timestamp).toBeGreaterThan(0);
    });

    it('should update configuration', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.ROUND_ROBIN, { maxRetries: 5 });

      balancer.updateConfig({ maxRetries: 10 });

      const config = balancer.getConfig();
      expect(config.maxRetries).toBe(10);
      expect(config.mode).toBe(LOAD_BALANCE_MODE.ROUND_ROBIN);
    });

    it('should handle mode change via updateConfig', () => {
      const balancer = new LoadBalancer(LOAD_BALANCE_MODE.ROUND_ROBIN);

      balancer.updateConfig({ mode: LOAD_BALANCE_MODE.RANDOM });

      expect(balancer.getMode()).toBe(LOAD_BALANCE_MODE.RANDOM);
      expect(balancer.getConfig().mode).toBe(LOAD_BALANCE_MODE.RANDOM);
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

      expect(strategy.select(candidates)?.id).toBe('a');
      expect(strategy.select(candidates)?.id).toBe('b');
      expect(strategy.select(candidates)?.id).toBe('a');
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

      expect(strategy.select(candidates)?.id).toBe('a');
    });

    it('should return null for empty array', () => {
      const strategy = new RoundRobinStrategy();
      expect(strategy.select([])).toBeNull();
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

      expect(selections.has('a')).toBe(true);
      expect(selections.has('b')).toBe(true);
    });

    it('should return null for empty array', () => {
      const strategy = new RandomStrategy();
      expect(strategy.select([])).toBeNull();
    });
  });

  describe('FailoverStrategy', () => {
    it('should select lowest priority', () => {
      const strategy = new FailoverStrategy();
      const candidates: ProviderCandidate[] = [
        { id: 'a', provider: 'p1', keyId: 'k1', model: 'm1', priority: 2, healthy: true },
        { id: 'b', provider: 'p2', keyId: 'k2', model: 'm1', priority: 1, healthy: true },
      ];

      expect(strategy.select(candidates)?.id).toBe('b');
    });

    it('should return null for empty array', () => {
      const strategy = new FailoverStrategy();
      expect(strategy.select([])).toBeNull();
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

      expect(countA).toBeGreaterThan(180);
    });

    it('should return null for empty array', () => {
      const strategy = new WeightedStrategy();
      expect(strategy.select([])).toBeNull();
    });
  });
});

describe('createStrategy', () => {
  it('should create RoundRobinStrategy', () => {
    const strategy = createStrategy(LOAD_BALANCE_MODE.ROUND_ROBIN);
    expect(strategy).toBeInstanceOf(RoundRobinStrategy);
  });

  it('should create RandomStrategy', () => {
    const strategy = createStrategy(LOAD_BALANCE_MODE.RANDOM);
    expect(strategy).toBeInstanceOf(RandomStrategy);
  });

  it('should create FailoverStrategy', () => {
    const strategy = createStrategy(LOAD_BALANCE_MODE.FAILOVER);
    expect(strategy).toBeInstanceOf(FailoverStrategy);
  });

  it('should create WeightedStrategy', () => {
    const strategy = createStrategy(LOAD_BALANCE_MODE.WEIGHTED);
    expect(strategy).toBeInstanceOf(WeightedStrategy);
  });

  it('should throw for invalid mode', () => {
    expect(() => createStrategy('invalid' as LoadBalanceMode)).toThrow('Unknown load balance mode');
  });
});

describe('getStrategyDescription', () => {
  it('should describe round_robin', () => {
    const desc = getStrategyDescription(LOAD_BALANCE_MODE.ROUND_ROBIN);
    expect(desc).toContain('sequentially');
  });

  it('should describe random', () => {
    const desc = getStrategyDescription(LOAD_BALANCE_MODE.RANDOM);
    expect(desc).toContain('Randomly');
  });

  it('should describe failover', () => {
    const desc = getStrategyDescription(LOAD_BALANCE_MODE.FAILOVER);
    expect(desc).toContain('priority');
  });

  it('should describe weighted', () => {
    const desc = getStrategyDescription(LOAD_BALANCE_MODE.WEIGHTED);
    expect(desc).toContain('weight');
  });
});

describe('isLoadBalanceMode', () => {
  it('should validate valid modes', () => {
    expect(isLoadBalanceMode('round_robin')).toBe(true);
    expect(isLoadBalanceMode('random')).toBe(true);
    expect(isLoadBalanceMode('failover')).toBe(true);
    expect(isLoadBalanceMode('weighted')).toBe(true);
  });

  it('should reject invalid modes', () => {
    expect(isLoadBalanceMode('invalid')).toBe(false);
    expect(isLoadBalanceMode('')).toBe(false);
    expect(isLoadBalanceMode(null)).toBe(false);
    expect(isLoadBalanceMode(undefined)).toBe(false);
    expect(isLoadBalanceMode(123)).toBe(false);
  });
});
