import { Menu } from '@ark-ui/react/menu';

const settingsIcon = (
	<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>
);
const signOutIcon = (
	<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/></svg>
);
const chevron = (
	<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m6 15 6-6 6 6"/></svg>
);

export function AccountMenu({ name, email, initials, csrf, showAdmin, adminHint }: {
	name: string;
	email: string;
	initials: string;
	csrf: string;
	showAdmin: boolean;
	adminHint: boolean;
}) {
	return (
		<Menu.Root positioning={{ placement: 'top-start', gutter: 8 }} unmountOnExit={false}>
			<Menu.Trigger className="acct-btn" aria-label="Account menu">
				<span className="av" aria-hidden="true">{initials}</span>
				<span className="acct-t"><span className="me-n">{name || email}</span><span className="me-e">{email}</span></span>
				{chevron}
			</Menu.Trigger>
			<Menu.Positioner>
				<Menu.Content className="acct-pop" aria-label="Account">
					<div className="ap-h"><span className="av">{initials}</span><div style={{ minWidth: 0 }}><p className="h3">{name || 'Account'}</p><p className="mute ap-e">{email}</p></div></div>
					<div className="ap-r">
						{showAdmin && <span className="badge b-green">Admin</span>}
						{adminHint && <p className="mute">Admin is available when you sign in with your school email.</p>}
					</div>
					<div className="ap-l">
						<Menu.Item value="settings" asChild>
							<a href="/account">{settingsIcon}Settings</a>
						</Menu.Item>
						<form method="post" action="/sign-out">
							<input type="hidden" name="csrf" value={csrf} />
							<Menu.Item value="sign-out" asChild>
								<button type="submit">{signOutIcon}Sign out</button>
							</Menu.Item>
						</form>
					</div>
				</Menu.Content>
			</Menu.Positioner>
		</Menu.Root>
	);
}
