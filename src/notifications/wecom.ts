// WeCom (企业微信) client — sends messages via a self-built app.
// API docs: https://developer.work.weixin.qq.com/document/path/90236
//
// Requires three env vars (see .env.example), all from the WeCom admin console
// at work.weixin.qq.com:
//   WECOM_CORP_ID   我的企业 → 企业信息 → 企业ID
//   WECOM_AGENT_ID  应用管理 → <your self-built app> → AgentId
//   WECOM_SECRET    应用管理 → <your self-built app> → Secret

const BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

let cache: TokenCache | null = null;

/** True only when all three WeCom credentials are present in the environment. */
export function isWecomConfigured(): boolean {
  return Boolean(
    process.env.WECOM_CORP_ID &&
    process.env.WECOM_AGENT_ID &&
    process.env.WECOM_SECRET
  );
}

/**
 * Fetch (and cache) an access_token. WeCom tokens last ~2h; we cache until 60s
 * before expiry and refresh on demand. Throws on any WeCom-side error.
 */
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now + 60_000) return cache.token;

  const corpId = process.env.WECOM_CORP_ID!;
  const secret = process.env.WECOM_SECRET!;
  const url = `${BASE}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;

  const res = await fetch(url);
  const data = (await res.json()) as {
    errcode: number;
    errmsg: string;
    access_token?: string;
    expires_in?: number;
  };

  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(`WeCom gettoken failed: ${data.errcode} ${data.errmsg}`);
  }

  cache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 7200) * 1000,
  };
  return cache.token;
}

/**
 * Send a plain-text message to a single WeCom user (their WeCom UserID).
 * Throws if WeCom rejects the call or the recipient is invalid.
 */
export async function sendWecomText(toUser: string, content: string): Promise<void> {
  const token = await getAccessToken();
  const agentId = Number(process.env.WECOM_AGENT_ID);

  const res = await fetch(`${BASE}/message/send?access_token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      touser: toUser,
      msgtype: 'text',
      agentid: agentId,
      text: { content },
      safe: 0,
    }),
  });

  const data = (await res.json()) as {
    errcode: number;
    errmsg: string;
    invaliduser?: string;
  };

  if (data.errcode !== 0) {
    throw new Error(`WeCom message/send failed: ${data.errcode} ${data.errmsg}`);
  }
  if (data.invaliduser) {
    throw new Error(`WeCom rejected recipient(s): ${data.invaliduser}`);
  }
}
