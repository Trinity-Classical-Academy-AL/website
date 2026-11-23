import { Listbox, createListCollection } from '@ark-ui/react/listbox';
import { Popover } from '@ark-ui/react/popover';
import { navigate } from 'astro:transitions/client';
import { useMemo, useState } from 'react';

type Option = { value: string; label: string };

/**
 * A filter pill for list pages: "Status: New ▾". Opens a searchable list;
 * picking an option sets one URL search param and navigates. '' clears it.
 */
export function FilterSelect({ param, label, value, options, clears = [] }: {
	param: string;
	label: string;
	value: string;
	options: Option[];
	/** Other params this filter replaces (legacy names). */
	clears?: string[];
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const current = options.find((option) => option.value === value) ?? options[0];
	const searchable = options.length > 6;
	const collection = useMemo(() => {
		const q = query.trim().toLowerCase();
		return createListCollection({ items: q ? options.filter((option) => option.label.toLowerCase().includes(q)) : options });
	}, [options, query]);
	const active = value !== '' && value !== options[0]?.value;

	function choose(next: string) {
		setOpen(false);
		if (next === value) return;
		const url = new URL(location.href);
		for (const key of [param, ...clears, 'contact']) url.searchParams.delete(key);
		if (next) url.searchParams.set(param, next);
		void navigate(url.pathname + url.search);
	}

	return (
		<Popover.Root
			open={open}
			onOpenChange={(details) => { setOpen(details.open); if (!details.open) setQuery(''); }}
			positioning={{ placement: 'bottom-start', gutter: 6 }}
			lazyMount
			unmountOnExit
		>
			<Popover.Trigger type="button" className="fsel" data-active={active ? '' : undefined} aria-label={`${label}: ${current?.label}`}>
				<span className="fsel-k">{label}</span>
				<span className="fsel-v">{current?.label}</span>
				<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
			</Popover.Trigger>
			<Popover.Positioner>
				<Popover.Content className="fsel-pop">
					<Listbox.Root
						collection={collection}
						value={[value]}
						onValueChange={(details) => choose(details.value[0] ?? '')}
						selectionMode="single"
						typeahead={!searchable}
					>
						{searchable && <Listbox.Input className="fsel-q" placeholder={`Search ${label.toLowerCase()}`} value={query} onChange={(event) => setQuery(event.currentTarget.value)} autoFocus />}
						<Listbox.Content className="fsel-list">
							{collection.items.map((item) => (
								<Listbox.Item key={item.value} item={item} className="fsel-item">
									<Listbox.ItemText>{item.label}</Listbox.ItemText>
									<Listbox.ItemIndicator className="fsel-check">
										<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
									</Listbox.ItemIndicator>
								</Listbox.Item>
							))}
							{collection.items.length === 0 && <p className="fsel-empty">No matches</p>}
						</Listbox.Content>
					</Listbox.Root>
				</Popover.Content>
			</Popover.Positioner>
		</Popover.Root>
	);
}
