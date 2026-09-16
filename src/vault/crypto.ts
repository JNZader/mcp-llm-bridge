/**
 * AES-256-GCM encryption/decryption helpers for the credential vault.
 *
 * Uses node:crypto with a 12-byte IV and 16-byte auth tag.
 * The master key must be exactly 32 bytes (256 bits).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface EncryptedData {
  encrypted: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @param masterKey - 32-byte encryption key
 * @returns Ciphertext, IV, and auth tag as Buffers
 */
export function encrypt(plaintext: string, masterKey: Buffer): EncryptedData {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv, { authTagLength: AUTH_TAG_BYTES });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return { encrypted, iv, authTag };
}

/**
 * Decrypt AES-256-GCM ciphertext back to a plaintext string.
 *
 * @param data - The encrypted data (ciphertext, IV, auth tag)
 * @param masterKey - 32-byte encryption key (must match the one used to encrypt)
 * @returns Decrypted plaintext string
 * @throws If the auth tag verification fails (wrong key or tampered data)
 */
export function decrypt(data: EncryptedData, masterKey: Buffer): string {
  if (data.authTag.length !== AUTH_TAG_BYTES) {
    throw new RangeError(`AES-GCM authentication tag must be exactly ${AUTH_TAG_BYTES} bytes`);
  }

  const decipher = createDecipheriv(ALGORITHM, masterKey, data.iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(data.authTag);
  return Buffer.concat([
    decipher.update(data.encrypted),
    decipher.final(),
  ]).toString('utf8');
}
