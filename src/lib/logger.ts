import type { AppConfig } from '../config.js';

export function buildLoggerOptions(config: AppConfig) {
  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
        'accessToken',
        'payload.accessToken',
        'payload.sdp',
        'payload.sdp.sdp',
      ],
      censor: '[redacted]',
    },
  };
}
