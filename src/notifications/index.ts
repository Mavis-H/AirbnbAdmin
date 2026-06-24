import { isWecomConfigured, sendWecomText } from './wecom.js';

export interface NotificationPerson {
  id: number;
  name: string;
  notify_method: string; // WeCom UserID, or 'none'
}

/**
 * Deliver a message to one person.
 *
 * - No `notify_method` ('none' / empty) → skipped (e.g. a member who doesn't
 *   receive pushes).
 * - WeCom not configured (no creds in env) → console stub, same as Phase 1, so
 *   local dev keeps working without credentials.
 * - WeCom configured → real 企业微信 push.
 *
 * Throws if a WeCom send fails. Batch callers (the future daily-push job)
 * should wrap each person in try/catch to isolate failures, the same way
 * `syncAllProperties` isolates per-property errors.
 */
export async function sendNotification(person: NotificationPerson, message: string): Promise<void> {
  if (!person.notify_method || person.notify_method === 'none') {
    console.log(`[notify skipped → ${person.name}: no notify_method]`);
    return;
  }

  if (!isWecomConfigured()) {
    console.log(`[notify → ${person.name} (${person.notify_method})]: ${message}`);
    return;
  }

  await sendWecomText(person.notify_method, message);
  console.log(`[notify → ${person.name} (${person.notify_method})] sent via WeCom`);
}
