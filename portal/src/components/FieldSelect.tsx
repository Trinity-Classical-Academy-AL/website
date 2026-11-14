import { Select, createListCollection } from '@ark-ui/react/select';
import { useEffect, useRef, useState } from 'react';

type Option = { value: string; label: string };

export function FieldSelect({ name, label, value, options, submit = false, id }: {
	name: string;
	label: string;
	value: string;
	options: Option[];
	submit?: boolean;
	id?: string;
}) {
	const root = useRef<HTMLDivElement>(null);
	const [selected, setSelected] = useState(value ? [value] : []);
	useEffect(() => {
		const form = root.current?.closest('form');
		const restore = () => setSelected(value ? [value] : []);
		form?.addEventListener('portal:rollback', restore);
		return () => form?.removeEventListener('portal:rollback', restore);
	}, [value]);
	const collection = createListCollection({ items: options });
	return (
		<Select.Root
			ref={root}
			collection={collection}
			name={name}
			value={selected}
			positioning={{ sameWidth: true, placement: 'bottom-start', gutter: 4 }}
			unmountOnExit={false}
			onValueChange={(details) => {
				const form = root.current?.closest('form');
				if (form?.getAttribute('aria-busy') === 'true') return;
				setSelected(details.value);
				if (!submit) return;
				window.setTimeout(() => form?.requestSubmit(), 0);
			}}
		>
			<Select.HiddenSelect />
			<Select.Control>
				<Select.Trigger className="inp" id={id} aria-label={label}>
					<Select.ValueText data-status />
				</Select.Trigger>
			</Select.Control>
			<Select.Positioner>
				<Select.Content>
					{collection.items.map((item) => (
						<Select.Item key={item.value} item={item}>
							<Select.ItemText>{item.label}</Select.ItemText>
						</Select.Item>
					))}
				</Select.Content>
			</Select.Positioner>
		</Select.Root>
	);
}
