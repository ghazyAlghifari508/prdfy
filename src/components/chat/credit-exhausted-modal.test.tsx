// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreditExhaustedModal } from "./credit-exhausted-modal";

const mockUseUserPlan = vi.fn();
vi.mock("@/hooks/use-user-plan", () => ({
	useUserPlan: () => mockUseUserPlan(),
}));

beforeEach(() => {
	mockUseUserPlan.mockReturnValue({
		data: { plan: "free", topUpEligible: false },
	});
	vi.restoreAllMocks();
});

afterEach(() => {
	cleanup();
});

describe("CreditExhaustedModal", () => {
	it("renders dialog with role, aria-modal, and aria-labelledby", () => {
		const { container } = render(
			<CreditExhaustedModal
				isOpen={true}
				onClose={() => {}}
				errorMessage="Saldo kredit Anda telah habis."
				projectId="proj-123"
				stage="prd"
				title="Kredit Habis"
			/>,
		);

		const dialog = container.querySelector('[role="dialog"]');
		expect(dialog).toBeDefined();
		expect(dialog?.getAttribute("aria-modal")).toBe("true");
		expect(dialog?.getAttribute("aria-labelledby")).toBe(
			"credit-exhausted-modal-title",
		);

		const title = container.querySelector("#credit-exhausted-modal-title");
		expect(title?.textContent).toBe("Kredit Habis");
	});

	it("dismisses on Escape key", () => {
		const onClose = vi.fn();
		render(
			<CreditExhaustedModal
				isOpen={true}
				onClose={onClose}
				errorMessage="Kredit habis"
				projectId="proj-123"
				stage="prd"
			/>,
		);

		const escapeEvent = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(escapeEvent);
		expect(onClose).toHaveBeenCalled();
	});

	it("renders subscription view directly for free plan users", () => {
		mockUseUserPlan.mockReturnValue({
			data: { plan: "free", topUpEligible: false },
		});
		render(
			<CreditExhaustedModal
				isOpen={true}
				onClose={vi.fn()}
				errorMessage="Kredit habis"
				projectId="p1"
				stage="prd"
				currentPlan="free"
			/>,
		);
		expect(screen.getByText("Berlangganan Pro")).toBeDefined();
	});

	it("renders topup view first for paid subscribers and allows switching to subscription view", () => {
		mockUseUserPlan.mockReturnValue({
			data: { plan: "pro", topUpEligible: true, credits: 30, remaining: 0 },
		});
		render(
			<CreditExhaustedModal
				isOpen={true}
				onClose={vi.fn()}
				errorMessage="Kredit habis"
				projectId="p1"
				stage="prd"
				currentPlan="pro"
			/>,
		);
		expect(screen.getByText("Isi Ulang Kredit Instan")).toBeDefined();
		const switchBtn = screen.getByText(/Lihat Paket Langganan/i);
		fireEvent.click(switchBtn);
		expect(screen.getByText("Berlangganan Pro")).toBeDefined();

		// Should render back button to switch back to top-up view
		const backBtn = screen.getByText(/Kembali ke Pilihan Top Up/i);
		fireEvent.click(backBtn);
		expect(screen.getByText("Isi Ulang Kredit Instan")).toBeDefined();
	});

	it("renders subscription view when title includes 'Pro' (paywall mode) even for paid subscribers", () => {
		mockUseUserPlan.mockReturnValue({
			data: { plan: "pro", topUpEligible: true, credits: 30, remaining: 0 },
		});
		render(
			<CreditExhaustedModal
				isOpen={true}
				onClose={vi.fn()}
				errorMessage="Fitur ini membutuhkan paket Pro."
				projectId="p1"
				stage="ac"
				currentPlan="pro"
				title="Lanjut ke AC butuh Pro"
			/>,
		);
		expect(screen.getByText("Lanjut ke AC butuh Pro")).toBeDefined();
		expect(screen.getByText("Berlangganan Pro")).toBeDefined();
	});

	it("allows selecting a package and clicking buy in topup view", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				redirect_url: "https://app.sandbox.midtrans.com/snap/v2/vtweb/mock",
			}),
		});
		global.fetch = fetchMock;

		mockUseUserPlan.mockReturnValue({
			data: { plan: "pro", topUpEligible: true, credits: 30, remaining: 0 },
		});
		render(
			<CreditExhaustedModal
				isOpen={true}
				onClose={vi.fn()}
				errorMessage="Kredit habis"
				projectId="p1"
				stage="prd"
				currentPlan="pro"
			/>,
		);

		// Select 40 credits package
		const package40 = screen.getByText(/Paket 40 Kredit/);
		fireEvent.click(package40);

		// Click buy button
		const buyBtn = screen.getByRole("button", { name: /Beli 40 Kredit/i });
		fireEvent.click(buyBtn);

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/payments/create",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					planId: "topup-40",
					returnUrl: "/",
					projectId: "p1",
				}),
			}),
		);
	});
});
