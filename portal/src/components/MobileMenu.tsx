import { Collapsible } from '@ark-ui/react/collapsible';
import { useEffect, useState, type ReactNode } from 'react';

export function MobileMenu({ initials, children }: { initials: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		document.getElementById('shell-m')?.classList.toggle('menu-open', open);
	}, [open]);
	return (
		<>
			<header className="mtop">
				<button type="button" className="menu" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
					<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
				</button>
				<img src="/assets/img/emblem-green.svg" alt="" />
				<span className="mtop-t">TCA Portal</span>
				<button type="button" className="av" aria-label="Account menu" onClick={() => setOpen(true)}>{initials}</button>
			</header>
			<Collapsible.Root open={open} onOpenChange={(details) => setOpen(details.open)} unmountOnExit={false} lazyMount={false}>
				<Collapsible.Content>{children}</Collapsible.Content>
			</Collapsible.Root>
		</>
	);
}
