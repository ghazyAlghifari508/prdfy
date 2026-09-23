// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopUpModal } from "./top-up-modal";

const mockUseUserPlan = vi.fn();
vi.mock("@/hooks/use-user-plan", () => ({
	useUserPlan: () => mockUseUserPlan(),
}));

describe("TopUpModal", () => {
	beforeEach(() => {
		mockUseUserPlan.mockReturnValue({
			data: {
				credits: 5,
				creditsUsed: 25,
				remaining: 5,
				currentPeriodEnd: "2026-10-01T00:00:00.000Z",
			},
		});
		vi.restoreAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("renders dialog when open is true with package and price details", () => {
		render(<TopUpModal open={true} onOpenChange={vi.fn()} />);
		expect(screen.getByText("Isi Ulang Kredit")).toBeDefined();
		expect(screen.getAllByText(/15 Kredit/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/20\.000/).length).toBeGreaterThan(0);
		expect(
			screen.getByRole("button", { name: /Beli 15 Kredit/i }),
		).toBeDefined();
	});

	it("submits checkout to /api/payments/create and handles response", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				redirect_url: "https://app.sandbox.midtrans.com/snap/v2/vtweb/mock",
			}),
		});
		global.fetch = fetchMock;

		render(<TopUpModal open={true} onOpenChange={vi.fn()} />);
		const buyBtn = screen.getByRole("button", { name: /Beli 15 Kredit/i });
		fireEvent.click(buyBtn);

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/payments/create",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ planId: "topup-15" }),
				}),
			);
		});
	});

	it("allows selecting a larger top-up package", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				redirect_url: "https://app.sandbox.midtrans.com/snap/v2/vtweb/mock",
			}),
		});
		global.fetch = fetchMock;

		render(<TopUpModal open={true} onOpenChange={vi.fn()} />);
		const package40 = screen.getByText(/Paket 40 Kredit/);
		fireEvent.click(package40);

		const buyBtn = screen.getByRole("button", { name: /Beli 40 Kredit/i });
		fireEvent.click(buyBtn);

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/payments/create",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ planId: "topup-40" }),
				}),
			);
		});
	});

	it("displays error banner when payment creation fails", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			json: async () => ({ error: "Gagal membuat transaksi pembayaran" }),
		});
		global.fetch = fetchMock;

		render(<TopUpModal open={true} onOpenChange={vi.fn()} />);
		const buyBtn = screen.getByRole("button", { name: /Beli 15 Kredit/i });
		fireEvent.click(buyBtn);

		await waitFor(() => {
			expect(screen.getByRole("alert")).toBeDefined();
			expect(
				screen.getByText("Gagal membuat transaksi pembayaran"),
			).toBeDefined();
		});
	});

	it("does not render dialog content when open is false", () => {
		render(<TopUpModal open={false} onOpenChange={vi.fn()} />);
		expect(screen.queryByText("Isi Ulang Kredit")).toBeNull();
	});
});
