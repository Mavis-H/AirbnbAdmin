export const TASK_LABELS: Record<string, string> = {
  lock_code_change:  'Set Temp Lock Code',
  fill_booking_info: 'Fill In Booking Info',
  lockbox_return:    'Return Keys to Lockbox',
  battery_swap:      'Swap Smart-Lock Batteries',
  clean:             'Clean Unit',
  inspect:           'Inspect for Damage',
  check_supplies:    'Check Supplies',
  five_star_review:  'Send 5-Star Review',
  checkin_checklist: 'Pre-Arrival Checklist',
};

export function taskLabel(type: string): string {
  return TASK_LABELS[type] ?? type;
}
