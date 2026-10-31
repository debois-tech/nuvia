import { randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import { loadConfig } from '../config/config';
import { TotpService } from '../auth/totp.service';
import { CryptoService } from './crypto.service';

const env = {
  DATABASE_URL: 'postgres://x', APP_ORIGIN: 'https://nuvia.internal',
  APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};
const config = loadConfig(env as any);
const crypto = new CryptoService(config);

describe('passwords', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await crypto.hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await crypto.verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await crypto.verifyPassword('correct horse battery stapl', hash)).toBe(false);
  });
  it('salts every hash', async () => {
    expect(await crypto.hashPassword('same')).not.toBe(await crypto.hashPassword('same'));
  });
  it('rejects malformed stored hashes instead of throwing', async () => {
    expect(await crypto.verifyPassword('x', 'plaintext')).toBe(false);
  });
});

describe('encryption', () => {
  it('round-trips', () => {
    expect(crypto.decrypt(crypto.encrypt('JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP');
  });
  it('does not store plaintext', () => {
    expect(crypto.encrypt('JBSWY3DPEHPK3PXP')).not.toContain('JBSWY3DPEHPK3PXP');
  });
  it('detects tampering', () => {
    const [v, iv, tag, ct] = crypto.encrypt('secret').split('.');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 1;
    expect(() => crypto.decrypt([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });
  it('fails under a different key', () => {
    const other = new CryptoService(loadConfig({ ...env, APP_ENCRYPTION_KEY: randomBytes(32).toString('base64') } as any));
    expect(() => other.decrypt(crypto.encrypt('secret'))).toThrow();
  });
});

describe('generated secrets', () => {
  it('makes temporary passwords of the requested length without look-alike characters', () => {
    const p = crypto.tempPassword(40);
    expect(p).toHaveLength(40);
    expect(p).not.toMatch(/[01OlI]/);
  });
  it('makes recovery codes in XXXX-XXXX-XXXX form', () => {
    expect(crypto.recoveryCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

describe('TOTP', () => {
  const totp = new TotpService(config);
  it('accepts the current code and returns its step', () => {
    const secret = totp.generateSecret();
    const step = totp.check(secret, authenticator.generate(secret));
    expect(step).toBe(Math.floor(Date.now() / 30000));
  });
  it('rejects malformed codes', () => {
    const secret = totp.generateSecret();
    expect(totp.check(secret, 'abcdef')).toBeNull();
    expect(totp.check(secret, '12345')).toBeNull();
  });
  it('builds a provisioning URI naming the issuer and org ID', () => {
    const uri = totp.uri('NV-0042', 'JBSWY3DPEHPK3PXP');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('NV-0042');
    expect(uri).toContain('issuer=Nuvia');
  });
});

describe('loadConfig', () => {
  it.each([
    [{ ...env, DATABASE_URL: undefined }, /DATABASE_URL/],
    [{ ...env, APP_ENCRYPTION_KEY: Buffer.from('short').toString('base64') }, /32 bytes/],
    [{ ...env, APP_ORIGIN: 'https://nuvia.internal/' }, /bare origin/],
    [{ ...env, COOKIE_SECURE: 'false', NODE_ENV: 'production' }, /not allowed in production/],
    [{ ...env, SESSION_IDLE_MINUTES: 'soon' }, /SESSION_IDLE_MINUTES/],
  ])('refuses an unsafe config %#', (bad, message) => {
    expect(() => loadConfig(bad as any)).toThrow(message);
  });
  it('defaults to binding on localhost only', () => {
    expect(config.bindAddr).toBe('127.0.0.1');
  });
});
