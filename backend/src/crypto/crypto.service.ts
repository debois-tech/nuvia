import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { AppConfig, CONFIG } from '../config/config';

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };
// No 0/O/1/l/I so temporary passwords can be read out loud.
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function scryptAsync(password: string, salt: Buffer, p: typeof SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, p.keylen, { N: p.N, r: p.r, p: p.p, maxmem: p.maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

@Injectable()
export class CryptoService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /** scrypt$N$r$p$salt$hash, so parameters can be raised later without breaking old hashes. */
  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scryptAsync(password, salt, SCRYPT);
    return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, 'base64');
    const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      keylen: expected.length,
      maxmem: SCRYPT.maxmem,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  }

  /** Burn the same CPU as a real check so unknown org IDs cannot be told apart by response time. */
  private dummyHash?: Promise<string>;
  async dummyVerify(password: string): Promise<void> {
    this.dummyHash ??= this.hashPassword('nuvia-dummy-password');
    await this.verifyPassword(password, await this.dummyHash);
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.config.encryptionKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const [v, iv, tag, ct] = payload.split('.');
    if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext format');
    const decipher = createDecipheriv('aes-256-gcm', this.config.encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  tempPassword(length = 16): string {
    let out = '';
    for (let i = 0; i < length; i++) out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
    return out;
  }

  /** Recovery codes look like ABCD-EFGH-JKLM and are stored hashed. */
  recoveryCode(): string {
    const chunk = () => {
      let s = '';
      for (let i = 0; i < 4; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
      return s;
    };
    return `${chunk()}-${chunk()}-${chunk()}`;
  }
}
