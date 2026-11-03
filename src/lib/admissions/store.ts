import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { getStore, type Store } from '@netlify/blobs';

export type StoredDoc<T> = { data: T; etag: string };

export interface DocStore {
	getJson<T>(key: string): Promise<StoredDoc<T> | null>;
	/**
	 * Writes JSON. Pass the previous etag to update, or omit it to create.
	 * Returns false when the condition fails so the caller can retry.
	 */
	setJson(key: string, data: unknown, etag?: string): Promise<boolean>;
	getBytes(key: string): Promise<{ data: Uint8Array; metadata: Record<string, string> } | null>;
	setBytes(key: string, data: Uint8Array, metadata: Record<string, string>): Promise<void>;
}

type FileEntry = {
	etag: string;
	metadata?: Record<string, string>;
	json?: unknown;
	base64?: string;
};

const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
	const previous = locks.get(key) ?? Promise.resolve();
	const run = previous.then(task, task);
	locks.set(
		key,
		run.then(
			() => undefined,
			() => undefined,
		),
	);
	return run;
}

function filePath(root: string, key: string): string {
	if (!/^[a-z0-9][a-z0-9/_:-]{0,180}$/i.test(key)) {
		throw new Error('Invalid store key.');
	}
	return join(root, `${key.replaceAll('/', '__')}.json`);
}

export function createFileStore(root: string): DocStore {
	const readEntry = async (key: string): Promise<FileEntry | null> => {
		try {
			const raw = await readFile(filePath(root, key), 'utf8');
			return JSON.parse(raw) as FileEntry;
		} catch {
			return null;
		}
	};

	const writeEntry = async (key: string, entry: FileEntry) => {
		const path = filePath(root, key);
		await mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.${randomUUID()}.tmp`;
		await writeFile(temporary, JSON.stringify(entry));
		await rename(temporary, path);
	};

	return {
		async getJson<T>(key: string): Promise<StoredDoc<T> | null> {
			const entry = await readEntry(key);
			if (!entry || !('json' in entry)) return null;
			return { data: entry.json as T, etag: entry.etag };
		},
		async setJson(key: string, data: unknown, etag?: string): Promise<boolean> {
			return withLock(key, async () => {
				const current = await readEntry(key);
				if (etag) {
					if (!current || current.etag !== etag) return false;
				} else if (current) {
					return false;
				}
				const body = JSON.stringify(data);
				await writeEntry(key, {
					etag: createHash('sha256').update(body).digest('hex').slice(0, 16),
					json: data,
				});
				return true;
			});
		},
		async getBytes(key: string) {
			const entry = await readEntry(key);
			if (!entry?.base64) return null;
			return {
				data: Buffer.from(entry.base64, 'base64'),
				metadata: entry.metadata ?? {},
			};
		},
		async setBytes(key: string, data: Uint8Array, metadata: Record<string, string>) {
			await withLock(key, async () => {
				const base64 = Buffer.from(data).toString('base64');
				await writeEntry(key, {
					etag: createHash('sha256').update(base64).digest('hex').slice(0, 16),
					base64,
					metadata,
				});
			});
		},
	};
}

function storeName(): string {
	const context = process.env.CONTEXT ?? '';
	if (context === 'production' || context === '') return 'admissions';
	return `admissions-${context}`;
}

function createBlobStore(): DocStore {
	const store: Store = getStore({ name: storeName(), consistency: 'strong' });
	return {
		async getJson<T>(key: string): Promise<StoredDoc<T> | null> {
			const result = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
			if (!result) return null;
			return { data: result.data as T, etag: result.etag ?? '' };
		},
		async setJson(key: string, data: unknown, etag?: string): Promise<boolean> {
			const result = await store.setJSON(key, data, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
			return result.modified;
		},
		async getBytes(key: string) {
			const result = await store.getWithMetadata(key, { type: 'arrayBuffer', consistency: 'strong' });
			if (!result?.data) return null;
			const metadata: Record<string, string> = {};
			for (const [name, value] of Object.entries(result.metadata ?? {})) {
				if (typeof value === 'string') metadata[name] = value;
			}
			return { data: new Uint8Array(result.data), metadata };
		},
		async setBytes(key: string, data: Uint8Array, metadata: Record<string, string>) {
			const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
			await store.set(key, arrayBuffer, { metadata });
		},
	};
}

export function getDocStore(): DocStore {
	if (process.env.ADMISSIONS_STORE === 'file') {
		const root = process.env.ADMISSIONS_DATA_DIR || join(process.cwd(), '.data', 'admissions');
		return createFileStore(root);
	}
	return createBlobStore();
}
