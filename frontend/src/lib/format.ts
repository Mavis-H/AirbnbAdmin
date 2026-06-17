// Human-friendly date/time formatting for ISO strings coming from the API.

export function formatDate(iso: string | null | undefined): string {
  // "2026-06-20T15:00:00" or "2026-06-20" → "Jun 20, 2026"
  if (!iso) return '';
  return new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export function formatShort(iso: string | null | undefined): string {
  // "2026-06-20" → "Jun 20"
  if (!iso) return '';
  return new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  // "2026-06-20T15:00:00" → "Jun 20, 2026, 3:00 PM"
  if (!iso) return '';
  const date = formatDate(iso);
  const time = iso.slice(11, 16);
  if (!time) return date;
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${date}, ${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}
