// Daily push job — sends each person their pending tasks for the day via WeCom.
// Wired to a cron in src/server.ts; also runnable manually for testing:
//   npm run push:test            → send today's push (real WeCom if configured)
//   npm run push:test -- --dry   → print messages, send nothing
//   npm run push:test -- 2026-06-25 --dry  → preview a specific day
//
// The effective assignee is already resolved on task.assignee_id (default →
// takeover → manual override), so we simply read each person's tasks for the day.

import db from '../db/client.js';
import { sendNotification } from './index.js';
import { taskLabel } from '../engine/taskLabels.js';

interface Person {
  id: number;
  name: string;
  notify_method: string;
}

interface TaskRow {
  type: string;
  note: string | null;
  property_name: string;
  date: string;
  checkout_at: string;
  next_checkin: string | null;
}

const peopleStmt = db.prepare(
  `SELECT id, name, notify_method FROM person
   WHERE notify_enabled = 1 AND notify_method NOT IN ('none', '')`,
);

// Pull today's tasks AND still-pending overdue ones from the last 7 days, so a
// missed task keeps getting re-pushed (bounded so a stale backlog ages out).
// Caller passes (assignee_id, overdueFloor = today-7, today).
const tasksStmt = db.prepare(`
  SELECT t.type, t.note, t.date, b.checkout_at, p.name AS property_name,
    (SELECT MIN(nb.checkin_at) FROM booking nb
     WHERE nb.property_id = b.property_id AND nb.checkin_at > b.checkout_at) AS next_checkin
  FROM task t
  JOIN booking b ON b.id = t.booking_id
  JOIN property p ON p.id = b.property_id
  WHERE t.assignee_id = ? AND t.status = 'pending'
    AND t.date >= ? AND t.date <= ?
  ORDER BY t.date ASC, p.name ASC, t.type ASC
`);

/** Today's date (YYYY-MM-DD) in the given IANA timezone, or server-local if unset. */
function dateInTz(tz: string | undefined, base = new Date()): string {
  // en-CA formats as YYYY-MM-DD; timeZone shifts the calendar day correctly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);
}

/** Human date label like "6月24日 周二" for the message header. */
function zhDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`); // noon avoids TZ-edge day shifts
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(d);
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Whole days from `from` to `to` (both YYYY-MM-DD); negative if `to` is earlier.
function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

// "Days left until it must be done" badge for an overdue task. Deadline is the
// day before the next guest checks in, or checkout+3 when no guest is booked yet.
function deadlineBadge(task: TaskRow, today: string): string {
  const deadline = task.next_checkin
    ? shiftDate(task.next_checkin.slice(0, 10), -1)
    : shiftDate(task.checkout_at.slice(0, 10), 3);
  const daysLeft = daysBetween(today, deadline);
  if (daysLeft > 0) return `还剩 ${daysLeft} 天`;
  if (daysLeft === 0) return '今天截止';
  return '已逾期';
}

/** One property-grouped block of task lines. */
function taskLines(tasks: TaskRow[], today: string, withBadge: boolean): string[] {
  const lines: string[] = [];
  let currentProperty = '';
  for (const task of tasks) {
    if (task.property_name !== currentProperty) {
      currentProperty = task.property_name;
      lines.push(`🏠 ${currentProperty}`);
    }
    const badge = withBadge ? `（${deadlineBadge(task, today)}）` : '';
    lines.push(`· ${taskLabel(task.type)}${badge}`);
    if (task.note) lines.push(`  备注：${task.note}`);
  }
  return lines;
}

/**
 * Build the Chinese message body for one person's tasks. Today's tasks come
 * first; still-pending overdue tasks follow in a 逾期任务 section, each tagged
 * with how many days remain until its hard deadline.
 */
export function buildMessage(dateStr: string, tasks: TaskRow[]): string {
  const todays = tasks.filter((t) => t.date === dateStr);
  const overdue = tasks.filter((t) => t.date < dateStr);

  const lines: string[] = [`【今日任务 ${zhDateLabel(dateStr)}】`, ''];
  lines.push(...taskLines(todays, dateStr, false));

  if (overdue.length > 0) {
    if (todays.length > 0) lines.push('');
    lines.push('⚠️ 逾期任务');
    lines.push(...taskLines(overdue, dateStr, true));
  }

  lines.push('', '请及时处理，谢谢！');
  return lines.join('\n');
}

export interface DailyPushOptions {
  date?: string; // YYYY-MM-DD; defaults to today in PUSH_TZ
  dryRun?: boolean; // print instead of send
}

/**
 * Send the daily push to every person with a notify_method. People with no
 * pending tasks for the day are skipped (no empty reminders). Per-person send
 * failures are isolated and logged, mirroring syncAllProperties.
 */
export async function sendDailyPush(opts: DailyPushOptions = {}): Promise<void> {
  const tz = process.env.PUSH_TZ;
  const date = opts.date ?? dateInTz(tz);
  const people = peopleStmt.all() as Person[];

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  const sevenDaysAgo = shiftDate(date, -7);

  for (const person of people) {
    const tasks = tasksStmt.all(person.id, sevenDaysAgo, date) as TaskRow[];
    if (tasks.length === 0) {
      skipped++;
      continue;
    }

    const message = buildMessage(date, tasks);
    if (opts.dryRun) {
      console.log(`--- ${person.name} (${person.notify_method}) ---\n${message}\n`);
      sent++;
      continue;
    }

    try {
      await sendNotification(person, message);
      sent++;
    } catch (err) {
      failed++;
      console.error(`[dailyPush] send to ${person.name} failed:`, err);
    }
  }

  console.log(`[dailyPush] ${date}: sent=${sent} skipped(no tasks)=${skipped} failed=${failed}`);
}

// CLI entry — only runs when invoked directly (not when imported by the server).
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env — rely on shell env */
  }
  const cliArgs = process.argv.slice(2);
  const dryRun = cliArgs.includes('--dry');
  const date = cliArgs.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  await sendDailyPush({ date, dryRun });
}
