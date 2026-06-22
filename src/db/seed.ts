import { fileURLToPath } from 'url';
import path from 'path';
import db from './client.js';
import { initSchema } from './schema.js';
import { syncProperty } from '../ical/sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_1 = path.resolve(__dirname, '../../fixtures/test1.ics');
const FIXTURE_2 = path.resolve(__dirname, '../../fixtures/test2.ics');

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
  ).run('Mavis & Andy').lastInsertRowid as number;

  const memberId = db.prepare(
    "INSERT INTO person (name, role, notify_method) VALUES (?, 'member', 'wecom_userid')"
  ).run('Mom & Dad').lastInsertRowid as number;

  // --- Properties (each points at its own local fixture .ics) ---
  const property1Id = db.prepare(`
    INSERT INTO property (name, ical_url, checkin_time, checkout_time, default_passcode)
    VALUES (?, ?, '15:00:00', '11:00:00', '135790')
  `).run('Seaside Cottage', FIXTURE_1).lastInsertRowid as number;

  const property2Id = db.prepare(`
    INSERT INTO property (name, ical_url, checkin_time, checkout_time, default_passcode)
    VALUES (?, ?, '16:00:00', '10:00:00', '975310')
  `).run('Downtown Loft', FIXTURE_2).lastInsertRowid as number;

  // --- Takeover (must exist BEFORE sync so task generation picks it up) ---
  // Member is away for the July stay; owner covers their on-site tasks.
  db.prepare(`
    INSERT INTO takeover (from_person_id, to_person_id, start_date, end_date)
    VALUES (?, ?, '2026-07-05', '2026-07-10')
  `).run(memberId, adminId);

  // --- Pull bookings from each fixture + generate tasks ---
  await syncProperty(property1Id, FIXTURE_1, /* useFile */ true);
  await syncProperty(property2Id, FIXTURE_2, /* useFile */ true);

  // --- Simulate admin entering temp passcodes / guest details for upcoming stays ---
  const bookings1 = db
    .prepare('SELECT id FROM booking WHERE property_id = ? ORDER BY checkin_at ASC')
    .all(property1Id) as { id: number }[];

  if (bookings1[0]) {
    db.prepare("UPDATE booking SET guest_name = ?, lock_code = ?, notes = ? WHERE id = ?")
      .run('Sarah Chen', '482913', 'Arriving late, ~9pm', bookings1[0].id);
  }
  if (bookings1[1]) {
    db.prepare("UPDATE booking SET guest_name = ?, lock_code = ? WHERE id = ?")
      .run('The Patels', '671024', bookings1[1].id);
  }

  const bookings2 = db
    .prepare('SELECT id FROM booking WHERE property_id = ? ORDER BY checkin_at ASC')
    .all(property2Id) as { id: number }[];

  if (bookings2[0]) {
    db.prepare("UPDATE booking SET guest_name = ?, lock_code = ?, notes = ? WHERE id = ?")
      .run('Marcus Webb', '305172', 'Long stay — monthly booking', bookings2[0].id);
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
