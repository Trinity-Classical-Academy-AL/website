import { manualProvider } from './manual.ts';
import type { PaymentProvider } from './types.ts';

export type { PaymentProvider } from './types.ts';

/** Every payment provider the portal knows. Add a processor here once one is chosen. */
export const paymentProviders: readonly PaymentProvider[] = [manualProvider];

export function paymentProvider(id: string): PaymentProvider | null {
	return paymentProviders.find((provider) => provider.id === id) ?? null;
}

/** The provider families pay through online, if any. None yet: the Billing page says "coming soon". */
export function onlinePaymentProvider(): PaymentProvider | null {
	return paymentProviders.find((provider) => provider.online) ?? null;
}
