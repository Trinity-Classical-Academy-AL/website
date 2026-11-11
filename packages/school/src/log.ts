export function logPortalEvent(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) {
	const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...fields });
	if (level === 'error') console.error(line);
	else console.log(line);
}
