import { mock } from 'node:test';

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;
type SetTimeoutArgs = Parameters<typeof globalThis.setTimeout>;
type ClearTimeoutArgs = Parameters<typeof globalThis.clearTimeout>;

export function createFakeTimeoutHandle(id: string): TimeoutHandle {
  return { id } as unknown as TimeoutHandle;
}

export function createMockSetTimeout(nextHandle: () => TimeoutHandle) {
  return Object.assign(
    mock.fn(function setTimeoutStub(..._args: SetTimeoutArgs): TimeoutHandle {
      return nextHandle();
    }),
    { __promisify__: globalThis.setTimeout.__promisify__ },
  );
}

export function createMockClearTimeout() {
  return mock.fn(function clearTimeoutStub(..._args: ClearTimeoutArgs): void {});
}
