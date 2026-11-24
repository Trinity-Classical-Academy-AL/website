// Books handoff (QuickBooks Online). Day one is a CSV export; a direct sync implements BooksSync later.
import { db, dbReady } from '../db.ts';
import { toCsv } from '../csv.ts';
import type { Result } from '../result.ts';
import { getBooksAccounts, mapEntry } from './billing-ledger.ts';
import { booksType, entryCategoryLabels, paymentMethodLabels, type EntryCategory, type LedgerEntry } from './billing-model.ts';

/** A direct QuickBooks sync, later. It returns QuickBooks' id for each entry it pushed. */
export interface BooksSync {
	push(entries: LedgerEntry[]): Promise<Result<{ refs: Record<string, string> }>>;
}

export type BooksExportRow = {
	date: string; type: string; customer: string; student: string; category: string; account: string;
	amount: string; dueDate: string; method: string; reference: string; memo: string; entryId: string;
};

/** Column names follow QuickBooks Online's invoice and payment import fields where they exist. */
export const booksExportColumns: { key: keyof BooksExportRow; label: string }[] = [
	{ key: 'date', label: 'Date' },
	{ key: 'type', label: 'Transaction Type' },
	{ key: 'customer', label: 'Customer' },
	{ key: 'student', label: 'Student' },
	{ key: 'category', label: 'Product/Service' },
	{ key: 'account', label: 'Account' },
	{ key: 'amount', label: 'Amount' },
	{ key: 'dueDate', label: 'Due Date' },
	{ key: 'method', label: 'Payment Method' },
	{ key: 'reference', label: 'Ref No' },
	{ key: 'memo', label: 'Memo' },
	{ key: 'entryId', label: 'Entry ID' },
];

/** Entries posted in [from, to], voids left out. `onlyNew` skips entries already exported. */
export async function booksExportRows(input: { from: string; to: string; onlyNew?: boolean }): Promise<{ rows: BooksExportRow[]; ids: string[] }> {
	await dbReady();
	const sql = db();
	const [entries, accounts] = await Promise.all([
		sql`
			select e.*, coalesce(nullif(c.name, ''), p.child_name, '') as child_name,
				coalesce(nullif(r.name, ''), r.email) as customer
			from finance_entries e
				join families f on f.id = e.family_id
				join families r on r.id = coalesce(f.merged_into_id, f.id)
				left join children c on c.id = e.child_id left join finance_plans p on p.id = e.plan_id
			where e.voided_at is null and e.posted_on between ${input.from} and ${input.to}
				${input.onlyNew ? sql`and e.exported_at is null` : sql``}
			order by e.posted_on, e.created_at, e.id`,
		getBooksAccounts(),
	]);
	const rows = entries.map((row) => {
		const entry = mapEntry(row);
		const accountKey = entry.kind === 'payment' || entry.kind === 'refund' ? 'payment' : entry.category;
		return {
			date: entry.postedOn, type: booksType(entry), customer: String(row.customer), student: entry.childName,
			category: entryCategoryLabels[entry.category as EntryCategory] ?? entry.category, account: accounts[accountKey] ?? '',
			amount: (entry.amountCents / 100).toFixed(2), dueDate: entry.dueOn ?? '', method: entry.method ? paymentMethodLabels[entry.method] : '',
			reference: entry.reference, memo: entry.memo, entryId: entry.id,
		};
	});
	return { rows, ids: rows.map((row) => row.entryId) };
}

export function booksExportCsv(rows: BooksExportRow[]): string {
	return toCsv(rows, booksExportColumns);
}

/** Stamp entries as handed to the books (export or sync). Only the first export's time is kept. */
export async function markEntriesExported(ids: string[], booksRefs: Record<string, string> = {}): Promise<number> {
	if (!ids.length) return 0;
	await dbReady();
	const sql = db();
	const rows = await sql`update finance_entries set exported_at = coalesce(exported_at, now()) where id in ${sql(ids)} returning id`;
	for (const [id, ref] of Object.entries(booksRefs)) await sql`update finance_entries set books_ref = ${ref} where id = ${id}`;
	return rows.length;
}

/** When the last export ran, for "only new since last export". */
export async function lastBooksExport(): Promise<string | null> {
	await dbReady();
	const [row] = await db()`select max(exported_at) as at from finance_entries`;
	return row?.at ? new Date(row.at).toISOString() : null;
}
