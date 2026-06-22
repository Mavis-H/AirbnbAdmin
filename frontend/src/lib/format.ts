// Human-friendly date/time formatting for ISO strings coming from the API.
// Chinese locale, 24-hour clock.

export function formatDate(iso: string | null | undefined): string {
  // "2026-06-20T15:00:00" or "2026-06-20" → "2026年6月20日"
  if (!iso) return '';
  return new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

export function formatShort(iso: string | null | undefined): string {
  // "2026-06-20" → "6月20日"
  if (!iso) return '';
  return new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('zh-CN', {
    month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  // "2026-06-20T15:00:00" → "2026年6月20日 15:00" (24-hour)
  if (!iso) return '';
  const date = formatDate(iso);
  const time = iso.slice(11, 16);
  return time ? `${date} ${time}` : date;
}
