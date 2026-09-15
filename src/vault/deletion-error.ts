const DELETION_CODE = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
} as const;

export type VaultDeletionCode = (typeof DELETION_CODE)[keyof typeof DELETION_CODE];

// Classification belongs to the exact error emitted by this module, not its properties.
const classifications = new WeakMap<object, VaultDeletionCode>();

export function createVaultDeletionError(code: VaultDeletionCode, message: string): Error {
  if ((code !== DELETION_CODE.UNAUTHORIZED && code !== DELETION_CODE.NOT_FOUND) || typeof message !== 'string') {
    throw new TypeError('Invalid Vault deletion error');
  }
  const error = new Error(message);
  classifications.set(error, code);
  return error;
}

/** No property/prototype access: unknown and revoked proxies remain unclassified. */
export function getVaultDeletionCode(error: unknown): VaultDeletionCode | undefined {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return undefined;
  return classifications.get(error);
}
