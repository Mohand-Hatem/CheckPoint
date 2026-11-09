import { createHmac, timingSafeEqual } from 'crypto';

// docs/05 §4.5: v1.{locationId}.{slot}.{base64url(HMAC-SHA256(qr_secret, "locationId|slot"))}
const TOKEN = /^v1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

export function qrSlot(nowMs: number, rotationSeconds: number): number {
  return Math.floor(nowMs / 1000 / rotationSeconds);
}

function signature(secret: Buffer, locationId: string, slot: number): string {
  return createHmac('sha256', secret).update(`${locationId}|${slot}`).digest('base64url');
}

export function signQrToken(secret: Buffer, locationId: string, slot: number): string {
  return `v1.${locationId}.${slot}.${signature(secret, locationId, slot)}`;
}

export function parseQrToken(token: string): { locationId: string; slot: number; signature: string } | null {
  const match = TOKEN.exec(token);
  return match ? { locationId: match[1], slot: Number(match[2]), signature: match[3] } : null;
}

/** True only for an untampered token of the current or previous slot, signed with this location's secret. */
export function isValidQrToken(token: string, secret: Buffer, nowMs: number, rotationSeconds: number): boolean {
  const parsed = parseQrToken(token);
  if (!parsed) return false;
  const current = qrSlot(nowMs, rotationSeconds);
  if (parsed.slot !== current && parsed.slot !== current - 1) return false;

  const expected = Buffer.from(signature(secret, parsed.locationId, parsed.slot));
  const given = Buffer.from(parsed.signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
