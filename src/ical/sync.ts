import db from '../db/client.js';
import { initSchema } from '../db/schema.js';
import { parseIcalUrl, parseIcalFile } from './parser.js';
import { generateTasksForBooking, createNewBookingAdminTasks } from '../engine/logic.js';

// Ensure tables exist whether this module is run standalone or via the server
initSchema();

interface Property {
  id: number;
  ical_url: string;
  checkin_time: string;
  checkout_time: string;
}

export async function syncProperty(propertyId: number, icalUrl: string, useFile = false) {
  const upsertBooking = db.prepare(`
    INSERT INTO booking (property_id, checkin_at, checkout_at, ical_uid)
    VALUES (@propertyId, @checkinAt, @checkoutAt, @icalUid)
    ON CONFLICT(ical_uid) DO UPDATE SET
      checkin_at  = excluded.checkin_at,
      checkout_at = excluded.checkout_at
  `);
  const findByUid = db.prepare('SELECT id FROM booking WHERE ical_uid = ?');

  const prop = db.prepare('SELECT * FROM property WHERE id = ?').get(propertyId) as Property;
  const bookings = useFile ? parseIcalFile(icalUrl) : await parseIcalUrl(icalUrl);

  const todayDate = new Date().toISOString().slice(0, 10);

  const sync = db.transaction(() => {
    for (const b of bookings) {
      const existing = findByUid.get(b.icalUid) as { id: number } | undefined;
      const isNew = !existing;

      const checkinAt = `${b.checkinDate}T${prop.checkin_time}`;
      const checkoutAt = `${b.checkoutDate}T${prop.checkout_time}`;

      upsertBooking.run({
        propertyId,
        checkinAt,
        checkoutAt,
        icalUid: b.icalUid,
      });

      const row = findByUid.get(b.icalUid) as { id: number };

      // Regenerate standard tasks for every booking
      generateTasksForBooking(row.id);

      // For brand-new bookings: also create admin prep tasks (lock code + fill info) dated today
      if (isNew) {
        createNewBookingAdminTasks(row.id, todayDate);
      }
    }
  });

  sync();
  console.log(`[sync] property ${propertyId}: synced ${bookings.length} bookings`);
}

export async function syncAllProperties() {
  const properties = db.prepare('SELECT id, ical_url FROM property').all() as {
    id: number;
    ical_url: string;
  }[];

  for (const p of properties) {
    // Isolate failures: one unreachable/invalid iCal URL must not abort the rest.
    try {
      await syncProperty(p.id, p.ical_url);
    } catch (err) {
      console.error(`[sync] property ${p.id} failed:`, (err as Error).message);
    }
  }
}
