/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		familyId: string;
		family: import('@tca/school').FamilyRow | null;
		sessionEmail: string;
		roles: Array<'prospect' | 'guardian' | 'admin'>;
	}
}
