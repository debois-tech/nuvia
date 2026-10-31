import { Inject, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { AppConfig, CONFIG } from '../config/config';

const STEP_SECONDS = 30;

@Injectable()
export class TotpService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    // Accept the previous and next 30s code too, to tolerate clock drift on a phone.
    authenticator.options = { step: STEP_SECONDS, window: 1, digits: 6 };
  }

  generateSecret(): string {
    return authenticator.generateSecret(20);
  }

  uri(orgId: string, secret: string): string {
    return authenticator.keyuri(orgId, this.config.mfaIssuer, secret);
  }

  /** The QR is drawn locally from the URI. Nothing is sent to an outside QR service. */
  qrDataUrl(uri: string): Promise<string> {
    return QRCode.toDataURL(uri, { margin: 1, width: 240 });
  }

  /** Returns the time step the code belongs to, or null if the code is wrong. The caller must refuse steps it has already seen. */
  check(secret: string, code: string, now = Date.now()): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null) return null;
    return Math.floor(now / 1000 / STEP_SECONDS) + delta;
  }
}
