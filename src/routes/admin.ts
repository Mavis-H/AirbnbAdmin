import type { FastifyInstance } from 'fastify';
import db from '../db/client.js';
import { generateTasksForBooking } from '../engine/logic.js';
import { syncProperty } from '../ical/sync.js';

export async function adminRoutes(app: FastifyInstance) {

  // --- Bookings ---

  // GET /api/admin/bookings
  app.get('/api/admin/bookings', (_req, reply) => {
    const rows = db.prepare(`
      SELECT b.*, p.name AS property_name
      FROM booking b
      JOIN property p ON p.id = b.property_id
      ORDER BY b.checkin_at ASC
    `).all();
    reply.send(rows);
  });

  // PATCH /api/admin/bookings/:id — update guest_name, lock_code, notes
  app.patch('/api/admin/bookings/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { guest_name?: string; lock_code?: string; notes?: string };

    db.prepare(`
      UPDATE booking
      SET guest_name = COALESCE(@guest_name, guest_name),
          lock_code  = COALESCE(@lock_code, lock_code),
          notes      = COALESCE(@notes, notes)
      WHERE id = @id
    `).run({ id: Number(id), ...body });

    reply.send({ ok: true });
  });

  // POST /api/admin/bookings/:id/generate-tasks — (re)generate tasks for one booking
  app.post('/api/admin/bookings/:id/generate-tasks', (req, reply) => {
    const { id } = req.params as { id: string };
    generateTasksForBooking(Number(id));
    reply.send({ ok: true });
  });

  // --- Tasks ---

  // PATCH /api/admin/tasks/:id — reassign or change status
  app.patch('/api/admin/tasks/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { assignee_id?: number; status?: 'pending' | 'done' };

    if (body.assignee_id !== undefined) {
      db.prepare(`
        UPDATE task SET assignee_id = ?, override = 1 WHERE id = ?
      `).run(body.assignee_id, Number(id));
    }
    if (body.status !== undefined) {
      db.prepare(`UPDATE task SET status = ? WHERE id = ?`).run(body.status, Number(id));
    }

    reply.send({ ok: true });
  });

  // --- Takeovers ---

  // GET /api/admin/takeovers
  app.get('/api/admin/takeovers', (_req, reply) => {
    const rows = db.prepare(`
      SELECT t.*,
        fp.name AS from_name,
        tp.name AS to_name
      FROM takeover t
      JOIN person fp ON fp.id = t.from_person_id
      JOIN person tp ON tp.id = t.to_person_id
      ORDER BY t.start_date ASC
    `).all();
    reply.send(rows);
  });

  // POST /api/admin/takeovers
  app.post('/api/admin/takeovers', (req, reply) => {
    const body = req.body as {
      from_person_id: number;
      to_person_id: number;
      start_date: string;
      end_date: string;
    };
    const result = db.prepare(`
      INSERT INTO takeover (from_person_id, to_person_id, start_date, end_date)
      VALUES (@from_person_id, @to_person_id, @start_date, @end_date)
    `).run(body);
    reply.send({ id: result.lastInsertRowid });
  });

  // DELETE /api/admin/takeovers/:id
  app.delete('/api/admin/takeovers/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    db.prepare('DELETE FROM takeover WHERE id = ?').run(Number(id));
    reply.send({ ok: true });
  });

  // --- Properties ---

  // GET /api/admin/properties
  app.get('/api/admin/properties', (_req, reply) => {
    reply.send(db.prepare('SELECT * FROM property').all());
  });

  // POST /api/admin/properties
  app.post('/api/admin/properties', (req, reply) => {
    const body = req.body as {
      name: string;
      ical_url: string;
      checkin_time?: string;
      checkout_time?: string;
      default_passcode?: string;
    };
    const result = db.prepare(`
      INSERT INTO property (name, ical_url, checkin_time, checkout_time, default_passcode)
      VALUES (@name, @ical_url, @checkin_time, @checkout_time, @default_passcode)
    `).run({
      checkin_time: '15:00:00',
      checkout_time: '11:00:00',
      default_passcode: null,
      ...body,
    });
    reply.send({ id: result.lastInsertRowid });
  });

  // PATCH /api/admin/properties/:id — edit property config
  app.patch('/api/admin/properties/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      ical_url?: string;
      checkin_time?: string;
      checkout_time?: string;
      default_passcode?: string;
    };
    db.prepare(`
      UPDATE property
      SET name             = COALESCE(@name, name),
          ical_url         = COALESCE(@ical_url, ical_url),
          checkin_time     = COALESCE(@checkin_time, checkin_time),
          checkout_time    = COALESCE(@checkout_time, checkout_time),
          default_passcode = COALESCE(@default_passcode, default_passcode)
      WHERE id = @id
    `).run({
      id: Number(id),
      name: null,
      ical_url: null,
      checkin_time: null,
      checkout_time: null,
      default_passcode: null,
      ...body,
    });
    reply.send({ ok: true });
  });

  // POST /api/admin/properties/:id/sync — pull iCal and regenerate tasks
  app.post('/api/admin/properties/:id/sync', async (req, reply) => {
    const { id } = req.params as { id: string };
    const prop = db.prepare('SELECT * FROM property WHERE id = ?').get(Number(id)) as
      | { id: number; ical_url: string }
      | undefined;

    if (!prop) return reply.status(404).send({ error: 'Property not found' });

    await syncProperty(prop.id, prop.ical_url);

    const bookings = db
      .prepare('SELECT id FROM booking WHERE property_id = ?')
      .all(prop.id) as { id: number }[];

    for (const b of bookings) generateTasksForBooking(b.id);

    reply.send({ ok: true, synced: bookings.length });
  });
}
