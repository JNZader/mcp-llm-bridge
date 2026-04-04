/**
 * Vitest type declarations for test files that import from 'vitest'.
 * These tests use vitest APIs but the project doesn't have vitest installed.
 */
declare module 'vitest' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): any;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export const vi: {
    fn: (...args: any[]) => any;
    spyOn: (...args: any[]) => any;
    mock: (...args: any[]) => any;
    mockImplementation: (...args: any[]) => any;
    clearAllMocks: () => void;
    resetAllMocks: () => void;
    restoreAllMocks: () => void;
    useFakeTimers: () => any;
    useRealTimers: () => void;
    advanceTimersByTime: (ms: number) => void;
    runAllTimers: () => void;
  };
}
