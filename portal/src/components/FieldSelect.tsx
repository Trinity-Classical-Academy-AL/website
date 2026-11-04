import { Select, createListCollection } from '@ark-ui/react/select';
import { useRef } from 'react';

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
	const collection = createListCollection({ items: options });
	return (
		<Select.Root
			ref={root}
			collection={collection}
			name={name}
			defaultValue={value ? [value] : []}
			positioning={{ sameWidth: true, placement: 'bottom-start', gutter: 4 }}
			unmountOnExit={false}
			onValueChange={() => {
				if (!submit) return;
				const form = root.current?.closest('form');
				window.setTimeout(() => form?.requestSubmit(), 0);
			}}
		>
			<Select.HiddenSelect />
			<Select.Control>
				<Select.Trigger className="inp" id={id} aria-label={label}>
					<Select.ValueText />
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
