/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		familyId: string;
		sessionEmail: string;
		roles: Array<'prospect' | 'guardian' | 'admin'>;
	}
}
