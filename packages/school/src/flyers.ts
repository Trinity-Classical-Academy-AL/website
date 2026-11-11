import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { getStore } from '@netlify/blobs';

/**
 * Flyer bytes stay in Netlify Blobs, not Postgres.
 * On the website site, the function's own blob store is used.
 * The admin site must set FLYER_SITE_ID and FLYER_BLOB_TOKEN to that same website store.
 * Local dev (ADMISSIONS_STORE=file, or no Netlify context) uses .data/admissions.
 */

const FLYER_KEY = /^(flyer|doc)\/[0-9a-f-]{36}$/i;

function storeName(): string {
	const context = process.env.CONTEXT ?? '';
	if (context === 'production' || context === '') return 'admissions';
	return `admissions-${context}`;
}

function fileRoot(): string {
	return process.env.ADMISSIONS_DATA_DIR || join(process.cwd(), '.data', 'admissions');
}

function useFileStore(): boolean {
	if (process.env.ADMISSIONS_STORE === 'file') return true;
	if (process.env.NETLIFY || process.env.FLYER_SITE_ID) return false;
	return true;
}

type FileEntry = { etag?: string; metadata?: Record<string, string>; base64?: string; json?: unknown };

async function readFileEntry(key: string): Promise<FileEntry | null> {
	try {
		return JSON.parse(await readFile(join(fileRoot(), `${key.replaceAll('/', '__')}.json`), 'utf8')) as FileEntry;
	} catch {
		return null;
	}
}

async function writeFileEntry(key: string, entry: FileEntry) {
	const path = join(fileRoot(), `${key.replaceAll('/', '__')}.json`);
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, JSON.stringify(entry));
	await rename(temporary, path);
}

function blobStore() {
	const siteID = process.env.FLYER_SITE_ID;
	const token = process.env.FLYER_BLOB_TOKEN;
	if (siteID && token) return getStore({ name: storeName(), siteID, token, consistency: 'strong' });
	return getStore({ name: storeName(), consistency: 'strong' });
}

export async function saveFlyerBytes(bytes: Uint8Array, metadata: { name: string; contentType: string }, prefix: 'flyer' | 'doc' = 'flyer'): Promise<{ key: string; name: string; contentType: string; size: number }> {
	const key = `${prefix}/${randomUUID()}`;
	if (useFileStore()) {
		await writeFileEntry(key, {
			etag: createHash('sha256').update(Buffer.from(bytes)).digest('hex').slice(0, 16),
			base64: Buffer.from(bytes).toString('base64'),
			metadata: { name: metadata.name, contentType: metadata.contentType },
		});
	} else {
		const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		await blobStore().set(key, arrayBuffer, { metadata: { name: metadata.name, contentType: metadata.contentType } });
	}
	return { key, name: metadata.name, contentType: metadata.contentType, size: bytes.byteLength };
}

export async function readFlyerBytes(key: string): Promise<{ data: Uint8Array; contentType: string; name: string } | null> {
	if (!FLYER_KEY.test(key)) return null;
	if (useFileStore()) {
		const entry = await readFileEntry(key);
		if (!entry?.base64) return null;
		return {
			data: Buffer.from(entry.base64, 'base64'),
			contentType: entry.metadata?.contentType || 'application/octet-stream',
			name: entry.metadata?.name || 'flyer',
		};
	}
	const result = await blobStore().getWithMetadata(key, { type: 'arrayBuffer', consistency: 'strong' });
	if (!result?.data) return null;
	const metadata = result.metadata ?? {};
	return {
		data: new Uint8Array(result.data),
		contentType: typeof metadata.contentType === 'string' ? metadata.contentType : 'application/octet-stream',
		name: typeof metadata.name === 'string' ? metadata.name : 'flyer',
	};
}

export async function readLegacyJson<T>(key: string): Promise<T | null> {
	if (useFileStore()) {
		const entry = await readFileEntry(key);
		return (entry?.json as T | undefined) ?? null;
	}
	try {
		const result = await blobStore().get(key, { type: 'json', consistency: 'strong' });
		return (result as T | null) ?? null;
	} catch {
		return null;
	}
}
