import ical from 'node-ical';
import fs from 'fs';
import path from 'path';

export interface ParsedBooking {
  icalUid: string;
  checkinDate: string;   // YYYY-MM-DD
  checkoutDate: string;  // YYYY-MM-DD
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function extractBookings(events: ical.CalendarResponse): ParsedBooking[] {
  const bookings: ParsedBooking[] = [];

  for (const event of Object.values(events)) {
    if (event.type !== 'VEVENT') continue;
    if (!event.start || !event.end) continue;

    // Airbnb iCal uses all-day DATE values; node-ical parses them as Date objects at midnight UTC
    const uid = event.uid ?? `${event.start.toISOString()}-${event.end.toISOString()}`;
    bookings.push({
      icalUid: uid,
      checkinDate: toDateStr(event.start as Date),
      checkoutDate: toDateStr(event.end as Date),
    });
  }

  // Sort ascending by check-in
  bookings.sort((a, b) => a.checkinDate.localeCompare(b.checkinDate));
  return bookings;
}

export async function parseIcalUrl(url: string): Promise<ParsedBooking[]> {
  const events = await ical.async.fromURL(url);
  return extractBookings(events);
}

export function parseIcalFile(filePath: string): ParsedBooking[] {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const events = ical.sync.parseICS(raw);
  return extractBookings(events);
}
