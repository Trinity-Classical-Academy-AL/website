import { isLocalDev } from '../dev/local-guard.ts';
import { chicagoToday, formatUsDate } from '../time.ts';
import type { TourStatus } from '../tours/model.ts';

export const CONTACT_TYPES = ['interview', 'inquiry', 'visit', 'teaching', 'newsletter', 'other'] as const;
export type ContactType = typeof CONTACT_TYPES[number];
export type IncomingDetails = {
 enrollmentYear?: string;
 children?: { name: string; grade: string; currentSchool: string }[];
 formalooStatus?: string;
 enrollmentStatus?: string;
 interest?: string;
};
export type IncomingInput = {
 externalSource: 'formaloo' | 'netlify-forms' | 'portal-account'; externalId: string; createdAt: string;
 name: string; email: string; phone: string; message: string; source: string;
 contactType: ContactType; details: IncomingDetails; status: TourStatus;
 priorYear: boolean; alreadyFamily: boolean; contactedAt: string | null; contactedBy: string | null;
};
export type IncomingRow = Omit<IncomingInput, 'externalSource' | 'externalId' | 'details'> & {
 id: string; externalSource: string; externalId: string | null; details: IncomingDetails & Record<string, unknown>;
};
export type IncomingActivity = { id: string; at: string; by: string; kind: 'imported' | 'contacted' | 'note' | 'status' | 'emailed'; note: string };
export type IncomingEnv = Record<string, string | undefined>;
export function incomingWritesAllowed(env: IncomingEnv = process.env): boolean {
 // Netlify does not expose CONTEXT to the deployed function at runtime, so production is also marked by an
 // explicit INCOMING_PRODUCTION=yes variable scoped to the production context only (previews never have it).
 return env.CONTEXT === 'production' || env.INCOMING_PRODUCTION === 'yes' || isLocalDev(env);
}
export function contactType(source: string, interest = ''): ContactType {
 if (source === 'formaloo_interview' || source === 'interview') return 'interview';
 if (source === 'newsletter') return 'newsletter';
 if (source === 'visit' || interest === 'visiting') return 'visit';
 if (source === 'teaching' || interest === 'teaching') return 'teaching';
 if (source === 'other' || interest === 'other') return 'other';
 return 'inquiry';
}
export function incomingDate(iso: string): string { return iso ? formatUsDate(chicagoToday(new Date(iso))) : ''; }
export function incomingDetailsText(details: IncomingDetails): string {
 return [details.enrollmentYear && `Enrollment year: ${details.enrollmentYear}`,
  ...(details.children || []).map(child => [child.name, child.grade, child.currentSchool].filter(Boolean).join(' · ')),
  details.formalooStatus && `Formaloo status: ${details.formalooStatus}`,
  details.enrollmentStatus && `Enrollment status: ${details.enrollmentStatus}`,
  details.interest && `Interest: ${details.interest}`].filter(Boolean).join('\n');
}
export function object(value: unknown): Record<string, unknown> {
 return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown, max = 200): string { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
export function instant(value: unknown): string | null {
 const raw = text(value, 60); return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}
