import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { contactType, instant, object, text, type IncomingInput } from './model.ts';
import { TOUR_STATUSES } from '../tours/model.ts';

export function tokenAuthorized(expected: string, actual: string | null): boolean {
 if (!expected || !actual) return false;
 return timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(actual).digest());
}
export function verifyNetlifySignature(body: string, token: string | null, secret: string): boolean {
 if (!secret || !token) return false;
 try {
  const parts = token.split('.'); if (parts.length !== 3) return false;
  const [head, payload, signature] = parts;
  const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
  if (header.alg !== 'HS256') return false;
  const expected = createHmac('sha256', secret).update(`${head}.${payload}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (claims.iss !== 'netlify' || typeof claims.sha256 !== 'string') return false;
  if (claims.exp !== undefined && (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now())) return false;
  return tokenAuthorized(createHash('sha256').update(body).digest('hex'), claims.sha256);
 } catch { return false; }
}
export function parseNetlifySubmission(value: unknown): IncomingInput | null {
 const row = object(value), data = object(row.data), source = text(row.form_name);
 if (!['contact', 'newsletter'].includes(source) || text(data['bot-field'])) return null;
 const externalId = text(row.id), createdAt = instant(row.created_at), email = text(data.email || row.email, 254).toLowerCase();
 if (!externalId || !createdAt || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
 return { externalSource: 'netlify-forms', externalId, createdAt,
  name: text(data.name || row.name, 160), email, phone: text(data.phone, 40), message: text(data.message, 2000), source,
  contactType: contactType(source, text(data.interest)), details: source === 'contact' ? { interest: text(data.interest) } : {},
  status: TOUR_STATUSES.NEW, priorYear: false, alreadyFamily: false, contactedAt: null, contactedBy: null,
 };
}
