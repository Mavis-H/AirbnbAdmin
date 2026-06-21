import db from './client.js';

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS person (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL CHECK(role IN ('admin', 'member')),
      notify_method TEXT NOT NULL DEFAULT 'none'
    );

    CREATE TABLE IF NOT EXISTS property (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT NOT NULL,
      ical_url         TEXT NOT NULL,
      checkin_time     TEXT NOT NULL DEFAULT '15:00:00',
      checkout_time    TEXT NOT NULL DEFAULT '11:00:00',
      default_passcode TEXT
    );

    CREATE TABLE IF NOT EXISTS booking (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id    INTEGER NOT NULL REFERENCES property(id),
      checkin_at     TEXT NOT NULL,
      checkout_at    TEXT NOT NULL,
      guest_name     TEXT,
      lock_code      TEXT,
      notes          TEXT,
      ical_uid       TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS task (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id   INTEGER NOT NULL REFERENCES booking(id),
      assignee_id  INTEGER NOT NULL REFERENCES person(id),
      date         TEXT NOT NULL,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
      override     INTEGER NOT NULL DEFAULT 0,
      note         TEXT
    );

    CREATE TABLE IF NOT EXISTS takeover (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      from_person_id INTEGER NOT NULL REFERENCES person(id),
      to_person_id   INTEGER NOT NULL REFERENCES person(id),
      start_date     TEXT NOT NULL,
      end_date       TEXT NOT NULL
    );
  `);

  // --- Lightweight migrations (for DBs created before a column was added) ---
  const taskCols = db.prepare('PRAGMA table_info(task)').all() as { name: string }[];
  if (!taskCols.some((c) => c.name === 'note')) {
    db.exec('ALTER TABLE task ADD COLUMN note TEXT');
  }
}

export type TaskType =
  | 'lock_code_change'
  | 'fill_booking_info'
  | 'lockbox_return'
  | 'battery_swap'
  | 'clean'
  | 'inspect'
  | 'check_supplies'
  | 'five_star_review'
  | 'checkin_checklist';
