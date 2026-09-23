export interface NavbarTopUpInput {
	user: unknown;
	plan?: string | null;
	topUpEligible?: boolean;
}

export function canShowNavbarTopUp(input: NavbarTopUpInput): boolean {
	if (!input.user) return false;
	if (!input.plan || input.plan === "free") return false;
	return Boolean(input.topUpEligible);
}
