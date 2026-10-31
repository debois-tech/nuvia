import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { SIGNATURE_HEADERS, verifySignature } from '@nuvia/shared';
import { AuthedRequest } from '../../auth/roles';
import { Clock } from '../../common/clock';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { DevicesService } from './devices.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Authenticates desktop-agent requests by their HMAC signature, not by a bearer token. Every failure
 * is the same bare 401 so the response doesn't reveal whether a device ID exists.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly devices: DevicesService, private readonly clock: Clock, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const deviceId = String(req.headers[SIGNATURE_HEADERS.device] ?? '');
    const tsRaw = String(req.headers[SIGNATURE_HEADERS.timestamp] ?? '');
    const sig = String(req.headers[SIGNATURE_HEADERS.signature] ?? '');
    if (!UUID.test(deviceId) || !/^\d{10,16}$/.test(tsRaw) || !sig) throw new UnauthorizedException();

    const ts = Number(tsRaw);
    if (Math.abs(this.clock.now().getTime() - ts) > this.cfg.clockSkewSeconds * 1000) throw new UnauthorizedException();

    const device = await this.devices.loadForAuth(deviceId);
    if (!device || device.revokedAt || !device.userActive) throw new UnauthorizedException();

    const path = req.originalUrl.split('?')[0];
    const body = req.rawBody ? req.rawBody.toString('utf8') : '';
    if (!verifySignature(device.secret, req.method, path, ts, body, sig)) throw new UnauthorizedException();

    req.user = device.user;
    req.device = { id: device.id, userId: device.userId };
    return true;
  }
}
