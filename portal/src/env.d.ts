/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		familyId: string;
		family: import('@tca/school').FamilyRow | null;
		sessionEmail: string;
		roles: Array<'prospect' | 'guardian' | 'admin' | 'staff' | 'finance' | 'super_admin' | 'developer' | 'student'>;
		access: import('@tca/school').SessionAccess | null;
	}
}

interface ImportMetaEnv {
	readonly PORTAL_CSS_VERSION: string;
}
