import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';

// Reuse a caller's id (e.g. from a proxy) only when it is short and log-safe.
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}
