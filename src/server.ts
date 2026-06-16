import Fastify from 'fastify';
import cors from '@fastify/cors';
import { initSchema } from './db/schema.js';
import { planRoutes } from './routes/plan.js';
import { adminRoutes } from './routes/admin.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: 'http://localhost:5173' });

initSchema();

await app.register(planRoutes);
await app.register(adminRoutes);

app.get('/health', async () => ({ ok: true }));

await app.listen({ port: 3000, host: '0.0.0.0' });
