import db from '../db/client.js';
import type { TaskType } from '../db/schema.js';
import {
  TASK_CATALOG,
  catalogByType,
  OPTIONAL_TYPES,
  isTypeActive,
} from './taskCatalog.js';

function loadPrefs(propertyId: number): Map<string, number> {
  const rows = db
    .prepare('SELECT type, enabled FROM property_task_pref WHERE property_id = ?')
    .all(propertyId) as { type: string; enabled: number }[];
  return new Map(rows.map((r) => [r.type, r.enabled]));
}

interface Booking {
  id: number;
  property_id: number;
  checkin_at: string;
  checkout_at: string;
  lock_code: string | null;
}

interface Person {
  id: number;
  role: 'admin' | 'member';
}

interface Takeover {
  from_person_id: number;
  to_person_id: number;
  start_date: string;
  end_date: string;
}

function dateOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveAssignee(
  date: string,
  defaultAssigneeId: number,
  takeovers: Takeover[]
): number {
  for (const t of takeovers) {
    if (
      t.from_person_id === defaultAssigneeId &&
      date >= t.start_date &&
      date <= t.end_date
    ) {
      return t.to_person_id;
    }
  }
  return defaultAssigneeId;
}

function insertTask(
  bookingId: number,
  assigneeId: number,
  date: string,
  type: TaskType
) {
  const existing = db
    .prepare('SELECT id FROM task WHERE booking_id = ? AND type = ?')
    .get(bookingId, type);

  // Skip if a task of this type already exists — whether auto-generated or
  // manually reassigned (override=1). This is what makes a manual assignment
  // survive re-syncs instead of getting a duplicate auto task created next to it.
  if (existing) return;

  db.prepare(`
    INSERT INTO task (booking_id, assignee_id, date, type, status, override)
    VALUES (?, ?, ?, ?, 'pending', 0)
  `).run(bookingId, assigneeId, date, type);
}

export function generateTasksForBooking(bookingId: number) {
  const booking = db
    .prepare('SELECT * FROM booking WHERE id = ?')
    .get(bookingId) as Booking | undefined;

  if (!booking) throw new Error(`Booking ${bookingId} not found`);

  const adminPerson = db
    .prepare("SELECT id FROM person WHERE role = 'admin' LIMIT 1")
    .get() as Person | undefined;

  const memberPerson = db
    .prepare("SELECT id FROM person WHERE role = 'member' LIMIT 1")
    .get() as Person | undefined;

  if (!adminPerson || !memberPerson) {
    throw new Error('Both an admin and a member person must exist before generating tasks');
  }

  const takeovers = db.prepare('SELECT * FROM takeover').all() as Takeover[];

  // Per-property task config: gate every task by whether its type is active here.
  const prefs = loadPrefs(booking.property_id);
  const act = (type: string) => isTypeActive(type, prefs);

  const checkoutDate = dateOf(booking.checkout_at);
  const checkinDate = dateOf(booking.checkin_at);

  // --- Checkout-day tasks (on-site → member) ---
  const memberOnCheckout = resolveAssignee(checkoutDate, memberPerson.id, takeovers);
  if (act('lockbox_return')) insertTask(bookingId, memberOnCheckout, checkoutDate, 'lockbox_return');
  if (act('battery_swap'))   insertTask(bookingId, memberOnCheckout, checkoutDate, 'battery_swap');
  if (act('clean'))          insertTask(bookingId, memberOnCheckout, checkoutDate, 'clean');
  if (act('inspect'))        insertTask(bookingId, memberOnCheckout, checkoutDate, 'inspect');
  if (act('check_supplies')) insertTask(bookingId, memberOnCheckout, checkoutDate, 'check_supplies');

  // Five-star review → admin, on checkout day
  if (act('five_star_review')) insertTask(bookingId, adminPerson.id, checkoutDate, 'five_star_review');

  // Admin prep tasks for the NEXT guest → on checkout day, only if there is a next booking.
  // lock_code_change (set temp code) and fill_booking_info (enter guest name/notes) always
  // pair together — both target the upcoming booking.
  const nextBooking = db.prepare(`
    SELECT id FROM booking
    WHERE property_id = ? AND checkin_at > ?
    ORDER BY checkin_at ASC
    LIMIT 1
  `).get(booking.property_id, booking.checkout_at) as { id: number } | undefined;

  if (nextBooking) {
    if (act('lock_code_change'))  insertTask(nextBooking.id, adminPerson.id, checkoutDate, 'lock_code_change');
    if (act('fill_booking_info')) insertTask(nextBooking.id, adminPerson.id, checkoutDate, 'fill_booking_info');
  }

  // --- Check-in day tasks (admin only) ---
  if (act('checkin_checklist')) insertTask(bookingId, adminPerson.id, checkinDate, 'checkin_checklist');

  // --- Optional tasks (opt-in per property; generated generically) ---
  const today = todayDateStr();
  for (const type of OPTIONAL_TYPES) {
    if (!act(type)) continue;
    const def = catalogByType.get(type)!;
    let date: string;
    if (def.leadDays != null) {
      // `leadDays` before check-in, but never earlier than today. ISO dates
      // compare lexicographically, so `>` gives the later date.
      const lead = shiftDate(checkinDate, -def.leadDays);
      date = lead > today ? lead : today;
    } else {
      date = def.timing === 'checkin' ? checkinDate : checkoutDate;
    }
    const basePerson = def.role === 'admin' ? adminPerson.id : memberPerson.id;
    const assignee = resolveAssignee(date, basePerson, takeovers);
    insertTask(bookingId, assignee, date, type as TaskType);
  }
}

// Called by sync when a brand-new booking is detected — reminds admin (dated today) to
// set up the temp code and fill in the booking's guest name / notes. Deduped, so it's a
// no-op if these tasks already exist.
export function createNewBookingAdminTasks(bookingId: number, todayDate: string) {
  const booking = db
    .prepare('SELECT property_id FROM booking WHERE id = ?')
    .get(bookingId) as { property_id: number } | undefined;
  if (!booking) return;

  const adminPerson = db
    .prepare("SELECT id FROM person WHERE role = 'admin' LIMIT 1")
    .get() as Person | undefined;

  if (!adminPerson) return;

  const prefs = loadPrefs(booking.property_id);
  if (isTypeActive('lock_code_change', prefs))
    insertTask(bookingId, adminPerson.id, todayDate, 'lock_code_change');
  if (isTypeActive('fill_booking_info', prefs))
    insertTask(bookingId, adminPerson.id, todayDate, 'fill_booking_info');
}

// The assignee the engine would pick for a task (default-by-role → takeover swap),
// ignoring any manual override. Used to decide whether a manual pick is actually a
// deviation (override=1) or just the default again (override=0).
export function computeDefaultAssignee(type: string, date: string): number | null {
  const def = catalogByType.get(type);
  if (!def) return null;
  const person = db
    .prepare('SELECT id FROM person WHERE role = ? LIMIT 1')
    .get(def.role) as { id: number } | undefined;
  if (!person) return null;
  const takeovers = db.prepare('SELECT * FROM takeover').all() as Takeover[];
  return resolveAssignee(date, person.id, takeovers);
}

// --- Per-property task config (used by the admin Properties UI) ---

// The full set of task types currently active for a property (standard minus
// disabled, plus enabled optional), in catalog order.
export function activeTaskTypes(propertyId: number): string[] {
  const prefs = loadPrefs(propertyId);
  return TASK_CATALOG.filter((d) => isTypeActive(d.type, prefs)).map((d) => d.type);
}

// Enable/disable a task type for a property, then reconcile existing tasks:
// enabling regenerates; disabling removes the type's *pending* tasks (keeps done).
export function setTaskPref(propertyId: number, type: string, enabled: boolean) {
  if (!catalogByType.has(type)) throw new Error(`Unknown task type: ${type}`);

  db.prepare(`
    INSERT INTO property_task_pref (property_id, type, enabled)
    VALUES (?, ?, ?)
    ON CONFLICT(property_id, type) DO UPDATE SET enabled = excluded.enabled
  `).run(propertyId, type, enabled ? 1 : 0);

  const bookings = db
    .prepare('SELECT id FROM booking WHERE property_id = ?')
    .all(propertyId) as { id: number }[];

  if (enabled) {
    for (const b of bookings) generateTasksForBooking(b.id);
  } else {
    db.prepare(`
      DELETE FROM task
      WHERE type = ? AND status = 'pending'
        AND booking_id IN (SELECT id FROM booking WHERE property_id = ?)
    `).run(type, propertyId);
  }
}

export function generateAllTasks() {
  const bookings = db.prepare('SELECT id FROM booking').all() as { id: number }[];
  for (const { id } of bookings) {
    generateTasksForBooking(id);
  }
  console.log(`[engine] generated tasks for ${bookings.length} bookings`);
}
