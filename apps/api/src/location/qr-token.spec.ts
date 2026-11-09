import { isValidQrToken, parseQrToken, qrSlot, signQrToken } from './qr-token';

describe('QR tokens (docs/05 §4.5, Phase 2 DoD)', () => {
  const secret = Buffer.alloc(32, 7);
  const otherSecret = Buffer.alloc(32, 9);
  const locationId = 'c0ffee00-0000-4000-8000-000000000003';
  const otherLocationId = 'c0ffee00-0000-4000-8000-000000000004';
  const rotation = 30;
  const now = Date.UTC(2026, 10, 9, 10, 0, 15); // 15 s into a slot
  const slot = qrSlot(now, rotation);
  const valid = (token: string, at = now) => isValidQrToken(token, secret, at, rotation);

  it('builds v1.{locationId}.{slot}.{base64url HMAC} and parses it back', () => {
    const token = signQrToken(secret, locationId, slot);
    expect(token).toMatch(new RegExp(`^v1\\.${locationId}\\.${slot}\\.[A-Za-z0-9_-]{43}$`));
    expect(parseQrToken(token)).toEqual({ locationId, slot, signature: token.split('.')[3] });
  });

  it('accepts the current slot and the previous one', () => {
    expect(valid(signQrToken(secret, locationId, slot))).toBe(true);
    expect(valid(signQrToken(secret, locationId, slot - 1))).toBe(true);
  });

  it('rejects an older slot and a future slot', () => {
    expect(valid(signQrToken(secret, locationId, slot - 2))).toBe(false);
    expect(valid(signQrToken(secret, locationId, slot + 1))).toBe(false);
  });

  it('rejects a token whose location was swapped (signature covers the location)', () => {
    const token = signQrToken(secret, locationId, slot);
    expect(valid(token.replace(locationId, otherLocationId))).toBe(false);
  });

  it("rejects a tampered signature, another location's secret and malformed input", () => {
    const token = signQrToken(secret, locationId, slot);
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(valid(flipped)).toBe(false);
    expect(isValidQrToken(token, otherSecret, now, rotation)).toBe(false);
    for (const bad of ['', 'v1', 'v2.' + token.slice(3), `v1.${locationId}.abc.sig`, `${token}.extra`]) {
      expect(valid(bad)).toBe(false);
      expect(parseQrToken(bad)).toBeNull();
    }
  });

  it('uses whole slots: a token stays valid until the end of the next slot', () => {
    const token = signQrToken(secret, locationId, slot);
    const slotEnd = (slot + 1) * rotation * 1000;
    expect(valid(token, slotEnd + rotation * 1000 - 1)).toBe(true);
    expect(valid(token, slotEnd + rotation * 1000)).toBe(false);
  });
});
