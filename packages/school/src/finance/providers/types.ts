import type { Result } from '../../result.ts';
import type { LedgerEntry, NewEntry } from '../billing-model.ts';

/**
 * The merchant slot. A payment processor is one module implementing this, added to the
 * registry in providers/index.ts. Every ledger write a provider causes goes through recordEntry.
 */
export interface PaymentProvider {
	/** 'manual' today. */
	id: string;
	label: string;
	/** True when families can pay through it from the Billing page. */
	online: boolean;
	startPayment?(input: { familyId: string; amountCents: number; returnUrl: string }): Promise<{ redirectUrl: string }>;
	/** Verify and read a processor event; return the entries it means (payments, refunds). */
	handleWebhook?(request: Request): Promise<Result<{ entries: NewEntry[] }>>;
	refund?(entry: LedgerEntry, amountCents: number): Promise<Result<{ providerRef: string }>>;
}
