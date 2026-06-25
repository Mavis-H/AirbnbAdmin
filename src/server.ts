import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import cron from 'node-cron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema } from './db/schema.js';
import { planRoutes } from './routes/plan.js';
import { adminRoutes } from './routes/admin.js';
import { wecomRoutes } from './routes/wecom.js';
import { syncAllProperties } from './ical/sync.js';
import { sendDailyPush } from './notifications/dailyPush.js';

// Load .env (WeCom creds + callback token/key) if present (Node native).
try {
  process.loadEnvFile();
} catch {
  /* no .env file — rely on shell environment */
}

const isProd = process.env.NODE_ENV === 'production';

const app = Fastify({ logger: true });

// In dev the Svelte app runs on the Vite origin and proxies /api here, so CORS
// is needed. In prod the frontend is served from this same origin (below), so
// cross-origin requests don't occur. Origin is env-overridable either way.
await app.register(cors, { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' });

initSchema();

await app.register(planRoutes);
await app.register(adminRoutes);
await app.register(wecomRoutes);

app.get('/health', async () => ({ ok: true }));

// Production: serve the built Svelte PWA from this server. `wildcard: false`
// registers a route per built file, so any unmatched GET falls through to the
// not-found handler, which returns index.html — letting client routes like
// /admin work on direct load/refresh (the deferred Phase 1 deployment task).
if (isProd) {
  const frontendDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../frontend/dist',
  );
  await app.register(fastifyStatic, { root: frontendDist, wildcard: false });

  app.setNotFoundHandler((req, reply) => {
    if (
      req.method === 'GET' &&
      !req.url.startsWith('/api') &&
      !req.url.startsWith('/wecom') &&
      req.url !== '/health'
    ) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not Found' });
  });
}

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

// Daily push of each person's tasks (after the 04:00 sync). Time/timezone are
// env-configurable: PUSH_CRON (default 07:00) + PUSH_TZ (IANA tz for the clock;
// falls back to server-local). Like sync, this only fires while the process is up.
const pushCron = process.env.PUSH_CRON ?? '0 7 * * *';
const pushTz = process.env.PUSH_TZ;
cron.schedule(
  pushCron,
  async () => {
    console.log('[cron] daily push starting');
    try {
      await sendDailyPush();
    } catch (err) {
      console.error('[cron] daily push failed:', err);
    }
  },
  pushTz ? { timezone: pushTz } : undefined,
);

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
