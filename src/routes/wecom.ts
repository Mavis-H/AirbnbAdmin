import type { FastifyInstance } from 'fastify';
import { verifySignature, decryptMessage } from '../notifications/wecomCrypto.js';

// WeCom 接收消息服务器URL endpoint. Its only job for our PoC is to pass the
// one-time URL verification handshake — clearing the prerequisite that unlocks
// the 企业可信IP (trusted IP) whitelist. We don't consume inbound messages.
//
// Configure WeCom's callback URL as:  https://<your-tunnel-host>/wecom/callback
// Requires env: WECOM_TOKEN, WECOM_AES_KEY (both generated in the WeCom dialog).

interface CallbackQuery {
  msg_signature?: string;
  timestamp?: string;
  nonce?: string;
  echostr?: string;
}

export async function wecomRoutes(app: FastifyInstance) {
  // WeCom POSTs inbound messages as XML; we don't read them, but register a
  // pass-through parser so these requests don't 415 before our handler runs.
  app.addContentTypeParser(
    ['text/xml', 'application/xml'],
    { parseAs: 'string' },
    (_req, body, done) => done(null, body),
  );

  // GET = URL verification handshake.
  app.get('/wecom/callback', async (req, reply) => {
    const { msg_signature, timestamp, nonce, echostr } = req.query as CallbackQuery;
    const token = process.env.WECOM_TOKEN;
    const aesKey = process.env.WECOM_AES_KEY;

    if (!token || !aesKey) {
      app.log.error('WECOM_TOKEN / WECOM_AES_KEY not set — cannot verify callback');
      return reply.code(500).send('callback credentials not configured');
    }
    if (!msg_signature || !timestamp || !nonce || !echostr) {
      return reply.code(400).send('missing verification params');
    }
    if (!verifySignature(token, timestamp, nonce, echostr, msg_signature)) {
      app.log.warn('WeCom callback signature mismatch');
      return reply.code(401).send('invalid signature');
    }

    const { message } = decryptMessage(aesKey, echostr);
    app.log.info('WeCom callback verified ✅');
    return reply.type('text/plain').send(message); // echo plaintext back
  });

  // POST = inbound messages/events. We don't act on them; ack empty so WeCom
  // treats it as "no reply" and doesn't retry.
  app.post('/wecom/callback', async (_req, reply) => {
    return reply.type('text/plain').send('');
  });
}
