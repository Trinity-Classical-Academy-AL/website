import { BUDGET_SCHEMA_SQL } from './budget-schema.ts';
import { BILLING_SCHEMA_SQL } from './billing-schema.ts';

/** Finance tables (budget first: billing's rate cards point at budget scenarios). Idempotent, like the rest of the schema. */
export const FINANCE_SCHEMA_SQL = BUDGET_SCHEMA_SQL + BILLING_SCHEMA_SQL;
