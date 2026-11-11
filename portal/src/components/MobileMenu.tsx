import { Collapsible } from '@ark-ui/react/collapsible';
import { useEffect, useState, type ReactNode } from 'react';

export function MobileMenu({
	initials,
	name,
	email,
	csrf,
	showAdmin,
	children,
}: {
	initials: string;
	name: string;
	email: string;
	csrf: string;
	showAdmin: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [account, setAccount] = useState(false);
	useEffect(() => {
		document.getElementById('shell-m')?.classList.toggle('menu-open', open);
	}, [open]);
	return (
		<>
			<header className="mtop">
				<button type="button" className="menu" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => { setAccount(false); setOpen((value) => !value); }}>
					{open ? (
						<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
					) : (
						<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
					)}
				</button>
				<img src="/assets/img/emblem-green.svg" alt="" />
				<span className="mtop-t">TCA Portal</span>
				<button type="button" className="av" aria-label="Account menu" aria-expanded={account} onClick={() => { setOpen(false); setAccount(true); }}>{initials}</button>
			</header>
			<Collapsible.Root open={open} onOpenChange={(details) => setOpen(details.open)} unmountOnExit={false} lazyMount={false}>
				<Collapsible.Content>{children}</Collapsible.Content>
			</Collapsible.Root>
			{account && (
				<div className="ov ov-sheet" onClick={() => setAccount(false)}>
					<div className="acct-pop sheet-pop" role="menu" aria-label="Account" onClick={(event) => event.stopPropagation()}>
						<div className="ap-h"><span className="av">{initials}</span><div style={{ minWidth: 0 }}><p className="h3">{name}</p><p className="mute ap-e">{email}</p></div></div>
						{showAdmin && <div className="ap-r"><span className="badge b-green">Admin</span></div>}
						<div className="ap-l">
							<a href="/account">Settings</a>
							<form method="post" action="/sign-out"><input type="hidden" name="csrf" value={csrf} /><button type="submit">Sign out</button></form>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
