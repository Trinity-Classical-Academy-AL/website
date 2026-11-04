import { PasswordInput } from '@ark-ui/react/password-input';

export function PasswordField({ id, name, autoComplete }: { id: string; name: string; autoComplete: string }) {
	return (
		<PasswordInput.Root>
			<PasswordInput.Control className="pw">
				<PasswordInput.Input id={id} name={name} className="inp" autoComplete={autoComplete} required />
				<PasswordInput.VisibilityTrigger className="pw-t">
					<PasswordInput.Indicator fallback="Show">Hide</PasswordInput.Indicator>
				</PasswordInput.VisibilityTrigger>
			</PasswordInput.Control>
		</PasswordInput.Root>
	);
}
