// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "@/store";
import { Navbar } from "./navbar";
import { canShowNavbarTopUp } from "./navbar-topup-helper";

let mockPathname = "/prd/test-project-1";

vi.mock("@tanstack/react-router", () => ({
	useLocation: ({
		select,
	}: {
		select?: (l: { pathname: string }) => unknown;
	} = {}) =>
		select ? select({ pathname: mockPathname }) : { pathname: mockPathname },
	useMatches: () => [],
	useNavigate: () => vi.fn(),
	useRouter: () => ({ invalidate: vi.fn() }),
	Link: ({
		children,
		to,
		className,
	}: {
		children: React.ReactNode;
		to: string;
		className?: string;
	}) => (
		<a href={to} className={className}>
			{children}
		</a>
	),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => ({
			data: { user: { id: "user-1", email: "user@test.com" } },
			isPending: false,
		}),
		signOut: vi.fn(),
	},
}));

const mockPlanData: {
	plan: "free" | "pro" | "hengker";
	topUpEligible: boolean;
} = {
	plan: "free",
	topUpEligible: false,
};

vi.mock("@/hooks/use-user-plan", () => ({
	useUserPlan: () => ({
		data: mockPlanData,
	}),
}));

vi.mock("@/components/billing/top-up-modal", () => ({
	TopUpModal: () => null,
}));

vi.mock("@/components/ui/theme-toggle", () => ({
	ThemeToggle: () => null,
}));

beforeEach(() => {
	mockPathname = "/prd/test-project-1";
	mockPlanData.plan = "free";
	mockPlanData.topUpEligible = false;
	useUIStore.getState().closePaywallModal();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("Navbar TopUp Integration Contract", () => {
	it("correctly identifies when to mount Top Up button in navbar", () => {
		expect(
			canShowNavbarTopUp({
				user: { id: "u1" },
				plan: "pro",
				topUpEligible: true,
			}),
		).toBe(true);
		expect(
			canShowNavbarTopUp({
				user: { id: "u1" },
				plan: "free",
				topUpEligible: false,
			}),
		).toBe(false);
	});

	it("integrates TopUpModal and top-up trigger button in navbar source", async () => {
		const source = await readFile(
			`${process.cwd()}/src/components/layout/navbar.tsx`,
			"utf8",
		);
		expect(source).toContain("TopUpModal");
		expect(source).toContain("canShowNavbarTopUp");
		expect(source).toContain("isTopUpOpen");
	});
});

describe("Navbar Paywall Integration Contract", () => {
	it("triggers openPaywallModal('ac') when free user clicks Upgrade on PRD step", () => {
		mockPathname = "/prd/test-project-1";
		render(<Navbar />);

		const upgradeButton = screen.getByRole("button", {
			name: /Upgrade ke Pro/i,
		});
		expect(upgradeButton).toBeDefined();

		fireEvent.click(upgradeButton);

		expect(useUIStore.getState().isPaywallOpen).toBe(true);
		expect(useUIStore.getState().paywallStage).toBe("ac");
	});

	it("integrates paywall modal trigger button with Lock icon in navbar source", async () => {
		const source = await readFile(
			`${process.cwd()}/src/components/layout/navbar.tsx`,
			"utf8",
		);
		expect(source).toContain('openPaywallModal("ac")');
		expect(source).toContain("<Lock");
		expect(source).toContain("text-amber-400");
	});
});
