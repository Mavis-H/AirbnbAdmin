import Fastify from 'fastify';
import cors from '@fastify/cors';
import cron from 'node-cron';
import { initSchema } from './db/schema.js';
import { planRoutes } from './routes/plan.js';
import { adminRoutes } from './routes/admin.js';
import { wecomRoutes } from './routes/wecom.js';
import { syncAllProperties } from './ical/sync.js';

// Load .env (WeCom creds + callback token/key) if present (Node native).
try {
  process.loadEnvFile();
} catch {
  /* no .env file — rely on shell environment */
}

const app = Fastify({ logger: true });

await app.register(cors, { origin: 'http://localhost:5173' });

initSchema();

await app.register(planRoutes);
await app.register(adminRoutes);
await app.register(wecomRoutes);

app.get('/health', async () => ({ ok: true }));

// Daily auto-sync of every property's iCal at 04:00 (off-peak). This only fires
// while the server process is running — a truly always-on daily pull needs the
// Phase 3 deployment. Trigger manually anytime via the per-property "Sync" button.
cron.schedule('0 4 * * *', async () => {
  console.log('[cron] daily iCal sync starting');
  try {
    await syncAllProperties();
    console.log('[cron] daily iCal sync done');
  } catch (err) {
    console.error('[cron] daily iCal sync failed:', err);
  }
});

await app.listen({ port: 3000, host: '0.0.0.0' });
