import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString('base64url');
	const hash = (await scrypt(password, salt, 32)) as Buffer;
	return `scrypt$${salt}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, salt, hash] = stored.split('$');
	if (scheme !== 'scrypt' || !salt || !hash) return false;
	const actual = (await scrypt(password, salt, 32)) as Buffer;
	const expected = Buffer.from(hash, 'base64url');
	if (actual.length !== expected.length) return false;
	return timingSafeEqual(actual, expected);
}
