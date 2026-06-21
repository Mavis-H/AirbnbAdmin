import type { FastifyInstance } from 'fastify';
import db from '../db/client.js';

interface TaskRow {
  id: number;
  date: string;
  type: string;
  status: string;
  override: number;
  note: string | null;
  booking_id: number;
  checkin_at: string;
  checkout_at: string;
  guest_name: string | null;
  lock_code: string | null;
  notes: string | null;
  property_id: number;
  property_name: string;
  assignee_id: number;
  assignee_name: string;
}

export async function planRoutes(app: FastifyInstance) {
  // GET /api/plan?week=YYYY-MM-DD&assignee=<id>
  // Returns tasks for the 7-day window starting on `week` (defaults to current Monday)
  app.get('/api/plan', (req, reply) => {
    const query = req.query as {
      week?: string;
      assignee?: string;
      property?: string;
      role?: string;
    };

    // Default to current ISO week Monday
    const weekStart = query.week ?? getMondayOf(new Date());
    const weekEnd = addDays(weekStart, 6);

    const params: (string | number)[] = [weekStart, weekEnd];
    let assigneeClause = '';
    if (query.assignee) {
      assigneeClause = 'AND t.assignee_id = ?';
      params.push(Number(query.assignee));
    }
    let propertyClause = '';
    if (query.property) {
      propertyClause = 'AND b.property_id = ?';
      params.push(Number(query.property));
    }
    // Member view requests role=member so parents only see their on-site tasks,
    // not owner-only ones (five-star review, check-in checklist, lock-code change).
    let roleClause = '';
    if (query.role === 'member' || query.role === 'admin') {
      roleClause = 'AND per.role = ?';
      params.push(query.role);
    }

    const rows = db.prepare(`
      SELECT
        t.id, t.date, t.type, t.status, t.override, t.note,
        t.booking_id, t.assignee_id,
        b.checkin_at, b.checkout_at, b.guest_name, b.lock_code, b.notes,
        b.property_id,
        p.name AS property_name,
        per.name AS assignee_name
      FROM task t
      JOIN booking b ON b.id = t.booking_id
      JOIN property p ON p.id = b.property_id
      JOIN person per ON per.id = t.assignee_id
      WHERE t.date BETWEEN ? AND ?
      ${assigneeClause}
      ${propertyClause}
      ${roleClause}
      ORDER BY t.date ASC, t.type ASC
    `).all(...params) as TaskRow[];

    reply.send(rows);
  });

  // GET /api/persons — for the assignee filter dropdown
  app.get('/api/persons', (_req, reply) => {
    const persons = db.prepare('SELECT id, name, role FROM person ORDER BY role ASC').all();
    reply.send(persons);
  });

  // GET /api/properties — for the admin property filter dropdown
  app.get('/api/properties', (_req, reply) => {
    const properties = db.prepare('SELECT id, name FROM property ORDER BY name ASC').all();
    reply.send(properties);
  });
}

function getMondayOf(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
