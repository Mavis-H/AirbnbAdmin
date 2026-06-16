import { fileURLToPath } from 'url';
import path from 'path';
import db from './client.js';
import { initSchema } from './schema.js';
import { syncProperty } from '../ical/sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../fixtures/test.ics');

async function seed() {
  initSchema();

  // --- Wipe existing data (idempotent reseed) ---
  db.exec(`
    DELETE FROM task;
    DELETE FROM takeover;
    DELETE FROM booking;
    DELETE FROM property;
    DELETE FROM person;
    DELETE FROM sqlite_sequence;
  `);

  // --- People ---
  const adminId = db.prepare(
    "INSERT INTO person (name, role, notify_method) VALUES (?, 'admin', 'none')"
  ).run('Andy (Owner)').lastInsertRowid as number;

  const memberId = db.prepare(
    "INSERT INTO person (name, role, notify_method) VALUES (?, 'member', 'wecom_userid')"
  ).run('Mom & Dad').lastInsertRowid as number;

  // --- Property (points at the local fixture .ics) ---
  const propertyId = db.prepare(`
    INSERT INTO property (name, ical_url, checkin_time, checkout_time, default_passcode)
    VALUES (?, ?, '15:00:00', '11:00:00', '135790')
  `).run('Seaside Cottage', FIXTURE).lastInsertRowid as number;

  // --- Takeover (must exist BEFORE sync so task generation picks it up) ---
  // Member is away for the July stay; owner covers their on-site tasks.
  db.prepare(`
    INSERT INTO takeover (from_person_id, to_person_id, start_date, end_date)
    VALUES (?, ?, '2026-07-05', '2026-07-10')
  `).run(memberId, adminId);

  // --- Pull bookings from the fixture + generate tasks ---
  await syncProperty(propertyId, FIXTURE, /* useFile */ true);

  // --- Simulate admin entering temp passcodes / guest details for upcoming stays ---
  const bookings = db
    .prepare('SELECT id FROM booking ORDER BY checkin_at ASC')
    .all() as { id: number }[];

  if (bookings[0]) {
    db.prepare("UPDATE booking SET guest_name = ?, lock_code = ?, notes = ? WHERE id = ?")
      .run('Sarah Chen', '482913', 'Arriving late, ~9pm', bookings[0].id);
  }
  if (bookings[1]) {
    db.prepare("UPDATE booking SET guest_name = ?, lock_code = ? WHERE id = ?")
      .run('The Patels', '671024', bookings[1].id);
  }

  // --- Report ---
  const counts = {
    persons: (db.prepare('SELECT COUNT(*) c FROM person').get() as { c: number }).c,
    properties: (db.prepare('SELECT COUNT(*) c FROM property').get() as { c: number }).c,
    bookings: (db.prepare('SELECT COUNT(*) c FROM booking').get() as { c: number }).c,
    tasks: (db.prepare('SELECT COUNT(*) c FROM task').get() as { c: number }).c,
    takeovers: (db.prepare('SELECT COUNT(*) c FROM takeover').get() as { c: number }).c,
  };

  console.log('[seed] done:', counts);
}

seed().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
