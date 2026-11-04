import { Dialog } from '@ark-ui/react/dialog';
import type { ReactNode } from 'react';

async function go(href: string) {
	const { navigate } = await import('astro:transitions/client');
	await navigate(href);
}

export function ArkDialog({ label, closeHref, children }: { label: string; closeHref: string; children: ReactNode }) {
	return (
		<Dialog.Root
			defaultOpen
			lazyMount={false}
			unmountOnExit={false}
			closeOnInteractOutside
			onOpenChange={(details) => {
				if (!details.open) window.setTimeout(() => void go(closeHref), 140);
			}}
		>
			<Dialog.Positioner className="ov">
				<Dialog.Content className="dlg" aria-label={label}>
					{children}
				</Dialog.Content>
			</Dialog.Positioner>
		</Dialog.Root>
	);
}
