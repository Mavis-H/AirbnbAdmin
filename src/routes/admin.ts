import type { FastifyInstance } from 'fastify';
import db from '../db/client.js';
import {
  generateTasksForBooking,
  activeTaskTypes,
  setTaskPref,
  computeDefaultAssignee,
} from '../engine/logic.js';
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

  // GET /api/admin/bookings/:id/tasks — ALL tasks for one booking (no week window).
  // The plan endpoint is windowed to 7 days, which hides checkout-day tasks on long
  // stays; the booking detail view needs the full set.
  app.get('/api/admin/bookings/:id/tasks', (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = db.prepare(`
      SELECT t.id, t.date, t.type, t.status, t.override, t.note,
             t.booking_id, t.assignee_id,
             per.name AS assignee_name
      FROM task t
      JOIN person per ON per.id = t.assignee_id
      WHERE t.booking_id = ?
      ORDER BY t.date ASC, t.type ASC
    `).all(Number(id));
    reply.send(rows);
  });

  // POST /api/admin/bookings/:id/generate-tasks — (re)generate tasks for one booking
  app.post('/api/admin/bookings/:id/generate-tasks', (req, reply) => {
    const { id } = req.params as { id: string };
    generateTasksForBooking(Number(id));
    reply.send({ ok: true });
  });

  // --- Tasks ---

  // PATCH /api/admin/tasks/:id — reassign, change status, or set a per-task note
  app.patch('/api/admin/tasks/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      assignee_id?: number;
      status?: 'pending' | 'done';
      note?: string | null;
    };

    if (body.assignee_id !== undefined) {
      // Only flag as a manual override if the pick differs from the engine default;
      // reverting to the default assignee clears the override (and its "手动" tag).
      const task = db
        .prepare('SELECT type, date FROM task WHERE id = ?')
        .get(Number(id)) as { type: string; date: string } | undefined;
      const def = task ? computeDefaultAssignee(task.type, task.date) : null;
      const override = def !== null && body.assignee_id === def ? 0 : 1;
      db.prepare('UPDATE task SET assignee_id = ?, override = ? WHERE id = ?')
        .run(body.assignee_id, override, Number(id));
    }
    if (body.status !== undefined) {
      db.prepare(`UPDATE task SET status = ? WHERE id = ?`).run(body.status, Number(id));
    }
    if (body.note !== undefined) {
      // Empty string clears the note back to NULL
      db.prepare(`UPDATE task SET note = ? WHERE id = ?`).run(body.note || null, Number(id));
    }

    reply.send({ ok: true });
  });

  // --- People (members & notification setup) ---

  // GET /api/admin/persons — includes notify_method + notify_enabled
  // (the plain /api/persons omits both)
  app.get('/api/admin/persons', (_req, reply) => {
    const rows = db
      .prepare(
        'SELECT id, name, role, notify_method, notify_enabled FROM person ORDER BY role ASC, id ASC',
      )
      .all();
    reply.send(rows);
  });

  // POST /api/admin/persons — add a person. notify_method is the WeCom UserID;
  // notify_enabled toggles whether they receive the daily push.
  app.post('/api/admin/persons', (req, reply) => {
    const body = req.body as {
      name?: string;
      role?: string;
      notify_method?: string;
      notify_enabled?: boolean;
    };
    if (!body.name || (body.role !== 'admin' && body.role !== 'member')) {
      return reply.status(400).send({ error: 'name and role (admin|member) are required' });
    }
    const result = db
      .prepare(
        'INSERT INTO person (name, role, notify_method, notify_enabled) VALUES (?, ?, ?, ?)',
      )
      .run(
        body.name,
        body.role,
        (body.notify_method || '').trim() || 'none',
        body.notify_enabled === false ? 0 : 1,
      );
    reply.send({ id: result.lastInsertRowid });
  });

  // PATCH /api/admin/persons/:id — edit name / role / notify_method / notify_enabled
  app.patch('/api/admin/persons/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      role?: string;
      notify_method?: string;
      notify_enabled?: boolean;
    };
    if (body.role !== undefined && body.role !== 'admin' && body.role !== 'member') {
      return reply.status(400).send({ error: 'role must be admin or member' });
    }
    db.prepare(`
      UPDATE person
      SET name           = COALESCE(@name, name),
          role           = COALESCE(@role, role),
          notify_method  = COALESCE(@notify_method, notify_method),
          notify_enabled = COALESCE(@notify_enabled, notify_enabled)
      WHERE id = @id
    `).run({
      id: Number(id),
      name: body.name ?? null,
      role: body.role ?? null,
      // empty string clears the UserID back to 'none'; undefined leaves it unchanged
      notify_method:
        body.notify_method !== undefined ? body.notify_method.trim() || 'none' : null,
      notify_enabled:
        body.notify_enabled !== undefined ? (body.notify_enabled ? 1 : 0) : null,
    });
    reply.send({ ok: true });
  });

  // DELETE /api/admin/persons/:id — blocked while referenced by tasks or takeovers
  app.delete('/api/admin/persons/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    const pid = Number(id);
    const tasks = (
      db.prepare('SELECT COUNT(*) AS c FROM task WHERE assignee_id = ?').get(pid) as { c: number }
    ).c;
    const takeovers = (
      db
        .prepare('SELECT COUNT(*) AS c FROM takeover WHERE from_person_id = ? OR to_person_id = ?')
        .get(pid, pid) as { c: number }
    ).c;
    if (tasks > 0 || takeovers > 0) {
      return reply.status(409).send({ error: 'in_use', tasks, takeovers });
    }
    db.prepare('DELETE FROM person WHERE id = ?').run(pid);
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

  // GET /api/admin/properties — each property includes its active task types
  app.get('/api/admin/properties', (_req, reply) => {
    const props = db.prepare('SELECT * FROM property').all() as { id: number }[];
    reply.send(props.map((p) => ({ ...p, active_task_types: activeTaskTypes(p.id) })));
  });

  // PATCH /api/admin/properties/:id/task-types — toggle one task type for a property
  app.patch('/api/admin/properties/:id/task-types', (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { type?: string; enabled?: boolean };
    if (!body.type || typeof body.enabled !== 'boolean') {
      return reply.status(400).send({ error: 'type and enabled are required' });
    }
    setTaskPref(Number(id), body.type, body.enabled);
    reply.send({ ok: true, active_task_types: activeTaskTypes(Number(id)) });
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

  // DELETE /api/admin/properties/:id — remove a property and all of its data
  // (bookings, their tasks incl. future pending ones, and task prefs).
  app.delete('/api/admin/properties/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    const pid = Number(id);
    const remove = db.transaction(() => {
      db.prepare(
        'DELETE FROM task WHERE booking_id IN (SELECT id FROM booking WHERE property_id = ?)'
      ).run(pid);
      db.prepare('DELETE FROM property_task_pref WHERE property_id = ?').run(pid);
      db.prepare('DELETE FROM booking WHERE property_id = ?').run(pid);
      db.prepare('DELETE FROM property WHERE id = ?').run(pid);
    });
    remove();
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
