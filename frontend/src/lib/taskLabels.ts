export const TASK_LABELS: Record<string, string> = {
  lock_code_change:  '设置临时门锁密码',
  fill_booking_info: '填写预订信息',
  lockbox_return:    '归还钥匙到密码盒',
  battery_swap:      '更换门锁电池',
  clean:             '清洁房间',
  inspect:           '检查房屋损坏',
  check_supplies:    '检查补充物资',
  five_star_review:  '发送五星好评',
  checkin_checklist: '入住前清单',
  // optional (opt-in per property) — mirror of src/engine/taskCatalog.ts
  confirm_if_have_pets: '确认是否携带宠物',
};

// Standard tasks default on; optional tasks are opt-in per property.
// Keep this split in sync with the backend catalog (src/engine/taskCatalog.ts).
export const STANDARD_TASK_TYPES = [
  'lock_code_change', 'fill_booking_info', 'lockbox_return', 'battery_swap',
  'clean', 'inspect', 'check_supplies', 'five_star_review', 'checkin_checklist',
];
export const OPTIONAL_TASK_TYPES = ['confirm_if_have_pets'];

export function taskLabel(type: string): string {
  return TASK_LABELS[type] ?? type;
}
