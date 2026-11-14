import { AsyncLocalStorage } from 'node:async_hooks';
import type postgres from 'postgres';

export type DatabaseTiming = { queries: number; duration: number; active: number; started: number };
const timing = new AsyncLocalStorage<DatabaseTiming>();

export function withDatabaseTiming<T>(task: (metrics: DatabaseTiming) => T): T {
	const metrics = { queries: 0, duration: 0, active: 0, started: 0 };
	return timing.run(metrics, () => task(metrics));
}

// Observe public promise methods without executing postgres.js's lazy queries early.
function observe<T extends Promise<unknown>>(query: T): T {
	const metrics = timing.getStore();
	if (!metrics) return query;
	const then = query.then.bind(query);
	let result: Promise<unknown> | undefined;
	const start = () => {
		if (!result) {
			metrics.queries++;
			if (metrics.active++ === 0) metrics.started = performance.now();
			const finish = () => {
				if (--metrics.active === 0) metrics.duration += performance.now() - metrics.started;
			};
			result = then((value) => { finish(); return value; }, (error) => { finish(); throw error; });
		}
		return result;
	};
	query.then = ((...args: Parameters<Promise<unknown>['then']>) => start().then(...args)) as T['then'];
	query.catch = ((...args: Parameters<Promise<unknown>['catch']>) => start().catch(...args)) as T['catch'];
	query.finally = ((...args: Parameters<Promise<unknown>['finally']>) => start().finally(...args)) as T['finally'];
	return query;
}

export function instrumentSql<T extends postgres.Sql>(sql: T): T {
	return new Proxy(sql, {
		apply(target, thisArg, args) {
			const value = Reflect.apply(target, thisArg, args);
			return value && typeof value.then === 'function' ? observe(value) : value;
		},
		get(target, key, receiver) {
			if (key === 'unsafe' || key === 'file') {
				const method = Reflect.get(target, key);
				return (...args: unknown[]) => observe(Reflect.apply(method, target, args));
			}
			if (key === 'begin') {
				const begin = target.begin;
				return (...args: unknown[]) => Reflect.apply(begin, target, args.map((arg) =>
					typeof arg === 'function' ? (tx: postgres.Sql) => arg(instrumentSql(tx)) : arg));
			}
			return Reflect.get(target, key, receiver);
		},
	});
}
