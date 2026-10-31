import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Request signing shared by the desktop agent (signs) and the API (verifies).
 *
 * The signature covers the timestamp and the exact bytes of the request body:
 *   HMAC-SHA256(deviceSecret, `${method}\n${path}\n${timestampMs}\n${rawBody}`) as hex.
 * Method and path are included so a signature for one endpoint can't be replayed on another.
 * Replay of the same request is blocked separately by the strictly increasing `seq`
 * in the body and the timestamp window.
 */
export const SIGNATURE_HEADERS = {
  device: 'x-nuvia-device',
  timestamp: 'x-nuvia-timestamp',
  signature: 'x-nuvia-signature',
} as const;

export function signRequest(
  secret: string,
  method: string,
  path: string,
  timestampMs: number,
  rawBody: string,
): string {
  return createHmac('sha256', secret)
    .update(`${method.toUpperCase()}\n${path}\n${timestampMs}\n${rawBody}`)
    .digest('hex');
}

export function verifySignature(
  secret: string,
  method: string,
  path: string,
  timestampMs: number,
  rawBody: string,
  signatureHex: string,
): boolean {
  if (!/^[0-9a-f]{64}$/i.test(signatureHex)) return false;
  const expected = Buffer.from(signRequest(secret, method, path, timestampMs, rawBody), 'hex');
  const given = Buffer.from(signatureHex, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
