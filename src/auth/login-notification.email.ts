import { Logger } from '@nestjs/common';
import { Resend } from 'resend';

const logger = new Logger('LoginNotificationEmail');

export interface NewDeviceDetails {
  userName: string;
  userEmail: string;
  deviceLabel: string;
  ipAddress: string | null;
  location: string | null;
  loginAt: Date;
}

/**
 * Same fire-and-forget pattern as sendCallNotificationEmail -- a
 * notification failure should never break login. Reuses the same Resend
 * sender/env var as call notifications, but its own recipient list
 * (LOGIN_NOTIFICATION_EMAILS) since who should hear about a new device
 * login isn't necessarily the same list as who hears about missed calls.
 */
export async function sendNewDeviceLoginEmail(details: NewDeviceDetails, recipientEmails: string[]) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('RESEND_API_KEY not set -- skipping new-device login email');
    return;
  }
  if (recipientEmails.length === 0) {
    logger.warn('No LOGIN_NOTIFICATION_EMAILS configured -- skipping new-device login email');
    return;
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: 'Custom Headlights <onboarding@resend.dev>',
      to: recipientEmails,
      subject: `New device login: ${details.userName}`,
      html:
        `<p><strong>Account:</strong> ${details.userName} (${details.userEmail})</p>` +
        `<p><strong>Device:</strong> ${details.deviceLabel}</p>` +
        `<p><strong>Location:</strong> ${details.location ?? 'Unknown (could not be geolocated)'}</p>` +
        `<p><strong>IP address:</strong> ${details.ipAddress ?? 'Unknown'}</p>` +
        `<p><strong>Time:</strong> ${details.loginAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>` +
        `<p style="color:#888;font-size:12px;">If this wasn't expected, consider changing this account's password or deactivating it from the Team page.</p>`,
    });
    if (error) logger.error(`Resend send failed: ${JSON.stringify(error)}`);
  } catch (err) {
    logger.error(`New-device login email failed: ${(err as Error).message}`);
  }
}
