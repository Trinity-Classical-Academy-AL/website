import { db, dbReady } from './db.ts';

/**
 * Locations for calendar items: places the school has used before (most used
 * first), and Google Places suggestions while typing when GOOGLE_PLACES_API_KEY
 * is set. Results lean toward Birmingham.
 */
export type PlaceSuggestion = { text: string; main: string; secondary: string };

/** Distinct locations used on calendar items, most used (then most recent) first. */
export async function knownLocations(limit = 12): Promise<string[]> {
	await dbReady();
	const rows = await db()`
		select location, count(*) as uses, max(starts_at) as last from events
		where trim(location) <> '' group by location order by count(*) desc, max(starts_at) desc limit ${limit}`;
	return rows.map((row) => String(row.location));
}

export const placesEnabled = () => Boolean(process.env.GOOGLE_PLACES_API_KEY);

/** Google Places (New) autocomplete. Empty when there's no key, the query is short, or Google fails. */
export async function searchPlaces(query: string, sessionToken = ''): Promise<PlaceSuggestion[]> {
	const key = process.env.GOOGLE_PLACES_API_KEY;
	const input = query.trim().slice(0, 120);
	if (!key || input.length < 3) return [];
	try {
		const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
			body: JSON.stringify({
				input, includedRegionCodes: ['us'],
				...(sessionToken ? { sessionToken: sessionToken.slice(0, 64) } : {}),
				// Birmingham, Alabama, within about 60 km.
				locationBias: { circle: { center: { latitude: 33.5186, longitude: -86.8104 }, radius: 60000 } },
			}),
			signal: AbortSignal.timeout(4000),
		});
		if (!response.ok) return [];
		const data = await response.json() as { suggestions?: { placePrediction?: { text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[] };
		return (data.suggestions ?? []).flatMap((item) => {
			const place = item.placePrediction;
			const text = place?.text?.text;
			if (!text) return [];
			return [{ text, main: place?.structuredFormat?.mainText?.text ?? text, secondary: place?.structuredFormat?.secondaryText?.text ?? '' }];
		}).slice(0, 5);
	} catch {
		return [];
	}
}
