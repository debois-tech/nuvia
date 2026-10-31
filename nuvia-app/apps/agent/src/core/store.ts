import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DeviceCredentials, SeqStore } from './api';

/** Encrypts the device secret at rest. In Electron this is backed by the OS keychain (safeStorage). */
export interface SecretCipher {
  encrypt(plain: string): string;
  decrypt(enc: string): string;
}

interface FileShape {
  serverUrl?: string;
  deviceId?: string;
  secretEnc?: string;
  lastSeq?: number;
}

export class AgentStore implements SeqStore {
  constructor(private readonly file: string, private readonly cipher: SecretCipher) {}

  private read(): FileShape {
    try {
      return existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
    } catch {
      return {};
    }
  }

  private write(data: FileShape) {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  credentials(): DeviceCredentials | null {
    const d = this.read();
    if (!d.serverUrl || !d.deviceId || !d.secretEnc) return null;
    try {
      return { serverUrl: d.serverUrl, deviceId: d.deviceId, secret: this.cipher.decrypt(d.secretEnc) };
    } catch {
      return null; // keychain changed or file copied from another machine: enroll again
    }
  }

  saveCredentials(c: DeviceCredentials) {
    this.write({ ...this.read(), serverUrl: c.serverUrl, deviceId: c.deviceId, secretEnc: this.cipher.encrypt(c.secret), lastSeq: 0 });
  }

  clear() {
    this.write({});
  }

  load(): number {
    return this.read().lastSeq ?? 0;
  }

  save(seq: number) {
    this.write({ ...this.read(), lastSeq: seq });
  }
}
