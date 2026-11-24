import type { PaymentProvider } from './types.ts';

/** Finance staff record checks, cash and bank transfers by hand on the household ledger. */
export const manualProvider: PaymentProvider = { id: 'manual', label: 'Recorded by Finance', online: false };
