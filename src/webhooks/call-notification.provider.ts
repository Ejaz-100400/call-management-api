import { Logger } from '@nestjs/common';
import { Resend } from 'resend';

const logger = new Logger('CallNotificationEmail');

export interface CallNotificationDetails {
  customerPhone: string;
  category: string;
  durationSeconds: number;
  status: 'completed' | 'missed';
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Fire-and-forget notification, called right from the webhook using the raw
 * payload's own duration/status fields -- customer phone, duration, and
 * status are all Exotel gives us up front, no need to wait for the AI
 * extraction pipeline to finish. Never throws: a notification failure
 * should never block call processing.
 */
export async function sendCallNotificationEmail(details: CallNotificationDetails, recipientEmails: string[]) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('RESEND_API_KEY not set -- skipping call notification email');
    return;
  }
  if (recipientEmails.length === 0) {
    logger.warn('No notification recipients configured -- skipping call notification email');
    return;
  }

  const categoryLabel = details.category === 'car_glasses' ? 'Car Glasses' : details.category === 'car_modifications' ? 'Car Modifications' : 'Unknown';
  const statusLabel = details.status === 'completed' ? 'Completed' : 'Missed call';

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: 'Custom Headlights <onboarding@resend.dev>',
      to: recipientEmails,
      subject: `${statusLabel}: ${details.customerPhone} (${categoryLabel})`,
      html:
        `<p><strong>Customer:</strong> ${details.customerPhone}</p>` +
        `<p><strong>Category:</strong> ${categoryLabel}</p>` +
        `<p><strong>Duration:</strong> ${formatDuration(details.durationSeconds)}</p>` +
        `<p><strong>Status:</strong> ${statusLabel}</p>`,
    });
    if (error) logger.error(`Resend send failed: ${JSON.stringify(error)}`);
  } catch (err) {
    logger.error(`Call notification email failed: ${(err as Error).message}`);
  }
}
