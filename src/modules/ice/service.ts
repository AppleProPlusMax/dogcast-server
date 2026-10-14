import { createHmac } from 'node:crypto';
import type { AppConfig } from '../../config.js';

export function buildIceServers(config: AppConfig, userId: string, nowMs = Date.now()) {
  const ttlSeconds = config.TURN_CREDENTIAL_TTL_SEC;
  const expiry = Math.floor(nowMs / 1000) + ttlSeconds;
  const username = `${expiry}:${userId}`;
  const credential = createHmac('sha1', config.TURN_AUTH_SECRET).update(username).digest('base64');
  const turnUrls = [...config.TURN_URLS, ...config.TURNS_URLS];
  const iceServers: Array<{ urls: string[]; username?: string; credential?: string }> = [];
  if (config.STUN_URLS.length > 0) {
    iceServers.push({ urls: config.STUN_URLS });
  }
  if (turnUrls.length > 0) {
    iceServers.push({ urls: turnUrls, username, credential });
  }
  return { iceServers, ttlSeconds };
}
