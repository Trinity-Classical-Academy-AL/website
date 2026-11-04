import { Tabs } from '@ark-ui/react/tabs';

type Tab = { href: string; label: string; current: boolean };

export function RouteTabs({ tabs, label }: { tabs: Tab[]; label: string }) {
	const current = tabs.find((tab) => tab.current)?.href ?? tabs[0]?.href ?? '';
	return (
		<Tabs.Root
			value={current}
			unmountOnExit={false}
			onValueChange={(details) => {
				if (details.value && details.value !== current) {
					void import('astro:transitions/client').then(({ navigate }) => navigate(details.value));
				}
			}}
		>
			<Tabs.List className="ptabs" aria-label={label}>
				{tabs.map((tab) => (
					<Tabs.Trigger key={tab.href} value={tab.href} className={tab.current ? 'on' : undefined} asChild>
						<a href={tab.href} aria-current={tab.current ? 'page' : undefined}>{tab.label}</a>
					</Tabs.Trigger>
				))}
			</Tabs.List>
		</Tabs.Root>
	);
}
