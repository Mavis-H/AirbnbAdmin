// WeCom (企业微信) callback crypto — implements the WXBizMsgCrypt scheme used to
// verify the 接收消息服务器URL. Docs:
// https://developer.work.weixin.qq.com/document/path/90968
//
// Verification flow: WeCom sends GET ?msg_signature&timestamp&nonce&echostr.
// We confirm the signature, AES-decrypt echostr, and echo the plaintext back.

import crypto from 'node:crypto';

/** SHA1 of the sorted token/timestamp/nonce/(echo|encrypt) — matches msg_signature. */
export function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  msgSignature: string,
): boolean {
  const sha1 = crypto
    .createHash('sha1')
    .update([token, timestamp, nonce, encrypt].sort().join(''))
    .digest('hex');
  // constant-time compare to avoid timing leaks
  const a = Buffer.from(sha1);
  const b = Buffer.from(msgSignature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Decrypt a WeCom AES payload.
 * EncodingAESKey is 43 chars of base64 (no padding) → 32-byte AES key; IV = first 16 bytes.
 * Plaintext layout: [16 random][4-byte big-endian msg length][msg][receiveid(corpid)].
 * Returns the inner message (for echostr verification, this is the value to echo back).
 */
export function decryptMessage(encodingAESKey: string, encrypted: string): { message: string; receiveId: string } {
  const aesKey = Buffer.from(encodingAESKey + '=', 'base64');
  if (aesKey.length !== 32) {
    throw new Error(`EncodingAESKey must decode to 32 bytes, got ${aesKey.length}`);
  }
  const iv = aesKey.subarray(0, 16);

  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]);

  // strip PKCS#7 padding
  const pad = decrypted[decrypted.length - 1];
  decrypted = decrypted.subarray(0, decrypted.length - pad);

  const content = decrypted.subarray(16); // drop 16 random bytes
  const msgLen = content.readUInt32BE(0);
  const message = content.subarray(4, 4 + msgLen).toString('utf8');
  const receiveId = content.subarray(4 + msgLen).toString('utf8');
  return { message, receiveId };
}
