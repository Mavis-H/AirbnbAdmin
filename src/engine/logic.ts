import db from '../db/client.js';
import type { TaskType } from '../db/schema.js';

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
    .prepare('SELECT id FROM task WHERE booking_id = ? AND type = ? AND override = 0')
    .get(bookingId, type);

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

  const checkoutDate = dateOf(booking.checkout_at);
  const checkinDate = dateOf(booking.checkin_at);

  // --- Checkout-day tasks (on-site → member) ---
  const memberOnCheckout = resolveAssignee(checkoutDate, memberPerson.id, takeovers);
  insertTask(bookingId, memberOnCheckout, checkoutDate, 'lockbox_return');
  insertTask(bookingId, memberOnCheckout, checkoutDate, 'battery_swap');
  insertTask(bookingId, memberOnCheckout, checkoutDate, 'clean');
  insertTask(bookingId, memberOnCheckout, checkoutDate, 'inspect');
  insertTask(bookingId, memberOnCheckout, checkoutDate, 'check_supplies');

  // Five-star review → admin, on checkout day
  insertTask(bookingId, adminPerson.id, checkoutDate, 'five_star_review');

  // lock_code_change → admin, on checkout day, only if there is a next booking
  const nextBooking = db.prepare(`
    SELECT id FROM booking
    WHERE property_id = ? AND checkin_at > ?
    ORDER BY checkin_at ASC
    LIMIT 1
  `).get(booking.property_id, booking.checkout_at) as { id: number } | undefined;

  if (nextBooking) {
    insertTask(nextBooking.id, adminPerson.id, checkoutDate, 'lock_code_change');
  }

  // --- Check-in day tasks (admin only) ---
  insertTask(bookingId, adminPerson.id, checkinDate, 'checkin_checklist');
}

// Called by sync when a brand-new booking is detected — reminds admin to set up
// the temp code immediately (today), but only if no lock_code_change task exists yet.
export function createLockCodeTaskForNewBooking(bookingId: number, todayDate: string) {
  const adminPerson = db
    .prepare("SELECT id FROM person WHERE role = 'admin' LIMIT 1")
    .get() as Person | undefined;

  if (!adminPerson) return;

  insertTask(bookingId, adminPerson.id, todayDate, 'lock_code_change');
}

export function generateAllTasks() {
  const bookings = db.prepare('SELECT id FROM booking').all() as { id: number }[];
  for (const { id } of bookings) {
    generateTasksForBooking(id);
  }
  console.log(`[engine] generated tasks for ${bookings.length} bookings`);
}
