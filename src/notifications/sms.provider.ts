import { Logger } from '@nestjs/common';

const logger = new Logger('SmsProvider');

export interface CallNotificationDetails {
  customerPhone: string;
  durationSeconds: number;
  status: 'completed' | 'missed';
}

/**
 * MSG91's numbers field wants bare "91" + 10 digits, no "+" and no leading
 * trunk "0" -- but numbers get stored/entered in a mix of formats
 * (+919999999999, 09999999999, 9999999999) across this app, so normalize
 * before sending rather than assume a shape.
 */
function toMsg91Mobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length !== 10) return null;
  return `91${last10}`;
}

/**
 * Confirmed live against MSG91's docs (control.msg91.com/api/v5/flow,
 * authkey header) -- but the request body's variable names are whatever the
 * DLT-approved template defines, which doesn't exist yet. Sending is a
 * deliberate no-op until MSG91_TEMPLATE_ID is set, so this is safe to call
 * unconditionally from the webhook handler well before DLT registration
 * finishes.
 */
export async function sendCallNotificationSms(recipientPhones: string[], details: CallNotificationDetails): Promise<void> {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;
  if (!authKey || !templateId) {
    logger.debug('MSG91_TEMPLATE_ID not set yet (DLT registration pending) -- skipping SMS notification.');
    return;
  }

  const mobiles = recipientPhones.map(toMsg91Mobile).filter((m): m is string => m !== null);
  if (mobiles.length === 0) return;

  const durationText = `${Math.floor(details.durationSeconds / 60)}:${(details.durationSeconds % 60).toString().padStart(2, '0')}`;

  try {
    const res = await fetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { accept: 'application/json', authkey: authKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        short_url: '0',
        recipients: mobiles.map((mobile) => ({
          mobiles: mobile,
          // Placeholder variable names -- rename these to match whatever the
          // actual DLT-approved template calls them once it's registered.
          VAR1: details.customerPhone,
          VAR2: durationText,
          VAR3: details.status === 'completed' ? 'Completed' : 'Missed',
        })),
      }),
    });
    if (!res.ok) {
      logger.warn(`MSG91 send failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    // A notification failure should never take down the webhook/call
    // pipeline it's riding along with.
    logger.warn(`MSG91 send threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}
