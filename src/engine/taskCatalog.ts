// The single source of truth for task types and their generation metadata.
// Standard types are generated for every property by default; optional types
// are opt-in per property (admin enables them from the Properties UI).
//
// NOTE: the frontend mirrors the labels + the standard/optional split in
// frontend/src/lib/taskLabels.ts — keep the two in sync when adding a type.

export type TaskTiming = 'checkout' | 'checkin' | 'special';
// 'special' = the type has bespoke engine logic (lock_code_change / fill_booking_info
// attach to the *next* booking and only when one exists). All others are generated
// generically on their timing date.

export interface TaskDef {
  type: string;
  role: 'member' | 'admin';
  timing: TaskTiming;
  optional: boolean; // false = standard (on by default); true = opt-in per property
  // If set, the task is dated `leadDays` before check-in — but never earlier than
  // "today" (the generation/sync date). So a booking far out gets the task on
  // (check-in − leadDays); one within the window gets it immediately. Overrides `timing`.
  leadDays?: number;
}

export const TASK_CATALOG: TaskDef[] = [
  // --- Standard (default on) ---
  { type: 'lock_code_change',  role: 'admin',  timing: 'special',  optional: false },
  { type: 'fill_booking_info', role: 'admin',  timing: 'special',  optional: false },
  { type: 'lockbox_return',    role: 'member', timing: 'checkout', optional: false },
  { type: 'battery_swap',      role: 'member', timing: 'checkout', optional: false },
  { type: 'clean',             role: 'member', timing: 'checkout', optional: false },
  { type: 'inspect',           role: 'member', timing: 'checkout', optional: false },
  { type: 'check_supplies',    role: 'member', timing: 'checkout', optional: false },
  { type: 'five_star_review',  role: 'admin',  timing: 'checkout', optional: false },
  { type: 'checkin_checklist', role: 'admin',  timing: 'checkin',  optional: false },

  // --- Optional (opt-in per property) ---
  // Confirm with the guest 15 days before arrival (or right away if sooner).
  { type: 'confirm_if_have_pets', role: 'admin', timing: 'checkin', optional: true, leadDays: 15 },
];

export const catalogByType = new Map(TASK_CATALOG.map((d) => [d.type, d]));
export const OPTIONAL_TYPES = TASK_CATALOG.filter((d) => d.optional).map((d) => d.type);

/**
 * Effective per-property task config. The `property_task_pref` table is sparse —
 * it only stores deviations from the defaults:
 *   • a standard type is active UNLESS a row disables it (enabled = 0)
 *   • an optional type is active ONLY IF a row enables it (enabled = 1)
 */
export function isTypeActive(
  type: string,
  prefs: Map<string, number>, // type -> enabled (0/1), only rows that exist
): boolean {
  const def = catalogByType.get(type);
  if (!def) return false;
  if (def.optional) return prefs.get(type) === 1;
  return prefs.get(type) !== 0;
}
