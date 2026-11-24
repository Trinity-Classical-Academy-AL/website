import { Combobox, createListCollection } from '@ark-ui/react/combobox';
import { useEffect, useMemo, useRef, useState } from 'react';

type Suggestion = { text: string; main: string; secondary: string };
type Item = { value: string; label: string; main: string; secondary: string; group: 'recent' | 'google' };

/**
 * A location input with suggestions: places the school used before at the top
 * (filtered as you type), then Google Places results (when the server has a
 * key). Anything typed is kept as is; picking a suggestion fills it in.
 */
export function LocationField({ name, value, recent, placeholder = 'Trinity campus', id }: {
	name: string; value: string; recent: string[]; placeholder?: string; id?: string;
}) {
	const [input, setInput] = useState(value);
	const [google, setGoogle] = useState<Suggestion[]>([]);
	const [loading, setLoading] = useState(false);
	const session = useRef('');
	const timer = useRef<number | undefined>(undefined);
	const latest = useRef('');

	useEffect(() => () => window.clearTimeout(timer.current), []);

	const query = input.trim().toLowerCase();
	const items = useMemo<Item[]>(() => {
		const known = recent.filter((place) => !query || place.toLowerCase().includes(query)).slice(0, 6);
		const seen = new Set(known.map((place) => place.toLowerCase()));
		return [
			...known.map((place) => ({ value: place, label: place, main: place, secondary: '', group: 'recent' as const })),
			...google.filter((place) => !seen.has(place.text.toLowerCase())).map((place) => ({ value: place.text, label: place.text, main: place.main, secondary: place.secondary, group: 'google' as const })),
		];
	}, [recent, google, query]);
	const collection = useMemo(() => createListCollection({ items }), [items]);

	const search = (text: string) => {
		window.clearTimeout(timer.current);
		latest.current = text;
		if (text.trim().length < 3) { setGoogle([]); setLoading(false); return; }
		if (!session.current) session.current = crypto.randomUUID();
		setLoading(true);
		timer.current = window.setTimeout(async () => {
			try {
				const response = await fetch(`/admin/api/places?q=${encodeURIComponent(text)}&s=${session.current}`, { credentials: 'same-origin' });
				const data = await response.json() as { suggestions?: Suggestion[] };
				if (latest.current === text) setGoogle(data.suggestions ?? []);
			} catch {
				if (latest.current === text) setGoogle([]);
			} finally {
				if (latest.current === text) setLoading(false);
			}
		}, 250);
	};

	const recentItems = items.filter((item) => item.group === 'recent');
	const googleItems = items.filter((item) => item.group === 'google');
	const row = (item: Item) => (
		<Combobox.Item key={`${item.group}:${item.value}`} item={item} className="loc-item">
			<span className="loc-ic" aria-hidden="true">{item.group === 'recent'
				? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
				: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>}</span>
			<Combobox.ItemText className="loc-t"><span className="loc-main">{item.main}</span>{item.secondary && <span className="loc-sec">{item.secondary}</span>}</Combobox.ItemText>
		</Combobox.Item>
	);

	return (
		<Combobox.Root
			className="loc"
			collection={collection}
			inputValue={input}
			onInputValueChange={(details) => { setInput(details.inputValue); if (details.reason === 'input-change') search(details.inputValue); }}
			onValueChange={(details) => { const picked = details.value[0]; if (picked) { setInput(picked); session.current = ''; } }}
			allowCustomValue
			openOnClick
			selectionBehavior="replace"
			positioning={{ sameWidth: true, placement: 'bottom-start', gutter: 4 }}
			ids={id ? { input: id } : undefined}
		>
			<Combobox.Control className="loc-control">
				<Combobox.Input className="inp" name={name} placeholder={placeholder} autoComplete="off" />
			</Combobox.Control>
			<Combobox.Positioner>
				{(items.length > 0 || loading) && <Combobox.Content className="loc-pop">
					{recentItems.length > 0 && <Combobox.ItemGroup>
						<Combobox.ItemGroupLabel className="loc-h">Used before</Combobox.ItemGroupLabel>
						{recentItems.map(row)}
					</Combobox.ItemGroup>}
					{googleItems.length > 0 && <Combobox.ItemGroup>
						<Combobox.ItemGroupLabel className="loc-h">Places</Combobox.ItemGroupLabel>
						{googleItems.map(row)}
					</Combobox.ItemGroup>}
					{loading && googleItems.length === 0 && <p className="loc-note">Searching…</p>}
				</Combobox.Content>}
			</Combobox.Positioner>
		</Combobox.Root>
	);
}
