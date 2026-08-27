import { createHash } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import type { Request } from 'express';
import geoip from 'geoip-lite';
import { UAParser } from 'ua-parser-js';
import { PrismaService } from '../prisma/prisma.service';
import { sendNewDeviceLoginEmail } from './login-notification.email';

const logger = new Logger('LoginTrackingService');

function clientIp(req: Request): string | null {
  // Render (and most PaaS hosts) sit behind a proxy -- app.set('trust proxy', 1)
  // in main.ts makes Express populate req.ip from X-Forwarded-For correctly.
  // ::ffff:-prefixed IPv4-mapped addresses are normalized to plain IPv4 since
  // geoip-lite's lookup table doesn't match the ::ffff: form.
  const ip = req.ip ?? null;
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

@Injectable()
export class LoginTrackingService {
  constructor(private prisma: PrismaService) {}

  /**
   * Called once per fresh sign-in (see AuthController.me()) -- fingerprints
   * the browser+OS+device-type combo, upserts it against this user's known
   * devices, and fires a "new device" email the first time that combo is
   * seen for them. Never throws: a tracking failure should never block
   * login (the caller wraps this in try/catch as an extra safety net).
   */
  async recordLogin(user: User, req: Request): Promise<void> {
    const uaString = req.headers['user-agent'] as string | undefined;
    const parsed = new UAParser(uaString ?? '').getResult();
    const browser = parsed.browser.name ?? 'Unknown browser';
    const os = parsed.os.name ?? 'Unknown OS';
    const deviceType = parsed.device.type ?? 'desktop'; // ua-parser-js leaves this undefined for plain desktop browsers
    const deviceLabel = `${browser} on ${os} (${deviceType})`;

    const ip = clientIp(req);
    const geo = ip ? geoip.lookup(ip) : null;
    const location = geo ? [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || null : null;

    // Deliberately excludes IP from the fingerprint -- the same device on
    // wifi vs. mobile data would otherwise look "new" every time. This does
    // mean two different physical machines with an identical browser+OS+
    // type combo are indistinguishable -- a real limitation of UA-based
    // fingerprinting, not a bug.
    const fingerprint = createHash('sha256').update(`${browser}|${os}|${deviceType}`).digest('hex');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const existing = await this.prisma.userDevice.findUnique({
      where: { userId_fingerprint: { userId: user.id, fingerprint } },
    });

    if (existing) {
      await this.prisma.userDevice.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), loginCount: { increment: 1 }, ipAddress: ip, city: geo?.city, region: geo?.region, country: geo?.country },
      });
      return;
    }

    await this.prisma.userDevice.create({
      data: {
        userId: user.id,
        fingerprint,
        deviceLabel,
        deviceType,
        browser,
        os,
        ipAddress: ip,
        city: geo?.city,
        region: geo?.region,
        country: geo?.country,
      },
    });

    const recipients = (process.env.LOGIN_NOTIFICATION_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    // Fire-and-forget on purpose -- the DB write above (the part that
    // actually matters for future new-device detection) is already done.
    sendNewDeviceLoginEmail(
      { userName: user.name, userEmail: user.email, deviceLabel, ipAddress: ip, location, loginAt: new Date() },
      recipients,
    ).catch((err) => logger.error(`Failed to send new-device email: ${err.message}`));
  }

  /** Every device ever seen, across every account -- owner-only (see OwnerOnly). */
  async findAllDevices() {
    return this.prisma.userDevice.findMany({
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  /**
   * "Forget" a device -- deletes its row so the next login from that
   * browser+OS+type combo looks new again and re-triggers an email. Doesn't
   * affect the user's actual session/access; it's only a tracking reset.
   */
  async deleteDevice(id: string) {
    const device = await this.prisma.userDevice.findUnique({ where: { id } });
    if (!device) throw new NotFoundException(`Device ${id} not found`);
    await this.prisma.userDevice.delete({ where: { id } });
    return { deleted: true };
  }
}
