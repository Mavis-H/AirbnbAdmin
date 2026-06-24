// Manual PoC test — send a real WeCom message to yourself to validate Phase 3.
//
// Steps:
//   1. Register a WeCom self-built app and fill .env (see .env.example).
//   2. Bind your own WeChat to the enterprise and find your WeCom UserID.
//   3. Whitelist your current public IP in the app's 企业可信IP setting.
//   4. Run:  npm run notify:test -- <your-wecom-userid> ["custom message"]
//
// If the message lands in your WeChat, the whole notification path is proven.

import { sendNotification } from './index.js';

// Load .env into process.env if present (Node 20.12+ native). Falls back to
// whatever is already exported in the shell.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — rely on shell environment */
}

const toUser = process.argv[2];
const message = process.argv[3] ?? '✅ 测试消息：周转协调系统已接通企业微信推送。';

if (!toUser) {
  console.error('Usage: npm run notify:test -- <wecom_userid> ["message"]');
  process.exit(1);
}

await sendNotification({ id: 0, name: '测试', notify_method: toUser }, message);
console.log('done — check your WeChat.');
