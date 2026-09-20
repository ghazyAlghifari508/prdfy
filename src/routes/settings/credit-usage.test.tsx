// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreditExhaustedModal } from "@/components/chat/credit-exhausted-modal";
import {
	type CreditOperationItem,
	CreditUsageSection,
} from "@/components/settings/credit-usage";

vi.mock("@/hooks/use-user-plan", () => ({
	useUserPlan: () => ({
		data: {
			plan: "free",
			subscriptionState: "free_active",
		},
	}),
}));

const mockOperations: CreditOperationItem[] = [
	{
		id: "op-1",
		projectId: "proj-1",
		projectName: "Aplikasi Kasir Pro",
		kind: "prd_generation",
		stage: "prd",
		state: "settled",
		estimatedCredits: 3,
		reservedCredits: 3,
		maximumCredits: 5,
		finalCharge: 4,
		pricingVersion: "2026-09-20",
		metrics: {
			promptChars: 1500,
			prdSourceChars: 0,
			taskCount: 0,
			codebase: {
				fileCount: 0,
				totalBytes: 0,
				dependencyCount: 0,
			},
		},
		capApplied: false,
		createdAt: "2026-09-20T10:00:00.000Z",
		settledAt: "2026-09-20T10:01:00.000Z",
	},
	{
		id: "op-2",
		projectId: "proj-1",
		projectName: "Aplikasi Kasir Pro",
		kind: "ac_generation",
		stage: "ac",
		state: "failed",
		estimatedCredits: 2,
		reservedCredits: 0,
		maximumCredits: 3,
		finalCharge: 0,
		pricingVersion: "2026-09-20",
		metrics: {
			promptChars: 300,
			prdSourceChars: 4200,
			taskCount: 0,
		},
		capApplied: false,
		createdAt: "2026-09-20T11:00:00.000Z",
	},
	{
		id: "op-3",
		projectId: "proj-2",
		projectName: "Marketplace B2B",
		kind: "codebase_analysis",
		stage: "codebase",
		state: "released",
		estimatedCredits: 6,
		reservedCredits: 0,
		maximumCredits: 10,
		finalCharge: 0,
		pricingVersion: "2026-09-20",
		metrics: {
			promptChars: 0,
			codebase: {
				fileCount: 45,
				totalBytes: 150000,
				dependencyCount: 12,
			},
		},
		capApplied: false,
		createdAt: "2026-09-20T12:00:00.000Z",
	},
	{
		id: "op-4",
		projectId: "proj-2",
		projectName: "Marketplace B2B",
		kind: "task_generation",
		stage: "task",
		state: "reserved",
		estimatedCredits: 4,
		reservedCredits: 4,
		maximumCredits: 6,
		finalCharge: null,
		pricingVersion: "2026-09-20",
		metrics: {
			promptChars: 500,
			prdSourceChars: 5000,
			taskCount: 15,
		},
		capApplied: true,
		createdAt: "2026-09-20T13:00:00.000Z",
	},
	{
		id: "op-5",
		projectId: "proj-2",
		projectName: "Marketplace B2B",
		kind: "prd_generation",
		stage: "prd",
		state: "running",
		estimatedCredits: 2,
		reservedCredits: 2,
		maximumCredits: 4,
		finalCharge: null,
		pricingVersion: "2026-09-20",
		metrics: {
			promptChars: 800,
		},
		capApplied: false,
		createdAt: "2026-09-20T14:00:00.000Z",
	},
	{
		id: "op-6",
		projectId: "proj-1",
		projectName: "Aplikasi Kasir Pro",
		kind: "ac_generation",
		stage: "ac",
		state: "quarantined",
		estimatedCredits: 2,
		reservedCredits: 0,
		maximumCredits: 3,
		finalCharge: 0,
		pricingVersion: "2026-09-20",
		metrics: {
			promptChars: 400,
		},
		capApplied: false,
		createdAt: "2026-09-20T15:00:00.000Z",
	},
	{
		id: "op-7",
		projectId: "proj-1",
		projectName: "Aplikasi Kasir Pro",
		kind: "task_generation",
		stage: "task",
		state: "refunded",
		estimatedCredits: 3,
		reservedCredits: 0,
		maximumCredits: 5,
		finalCharge: 3,
		pricingVersion: "2026-09-20",
		metrics: {
			promptChars: 600,
		},
		capApplied: false,
		createdAt: "2026-09-20T16:00:00.000Z",
	},
];

describe("CreditUsageSection", () => {
	let container: HTMLDivElement;
	let root: Root | null = null;

	beforeEach(() => {
		(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		if (root) {
			act(() => {
				root?.unmount();
			});
			root = null;
		}
		container?.remove();
	});

	it("renders policy banner with required exact Indonesian text", () => {
		act(() => {
			root?.render(
				<CreditUsageSection
					availableCredits={25}
					reservedCredits={4}
					totalCreditsUsed={12}
					operations={mockOperations}
				/>,
			);
		});

		expect(container.textContent).toContain(
			"Biaya kredit dihitung berdasarkan jenis operasi dan kompleksitas context yang diproses. Estimasi dan batas maksimum ditampilkan sebelum proses dimulai. Operasi yang gagal tidak dikenakan biaya final.",
		);
	});

	it("renders summary stat cards (available, reserved when > 0, spent, and stage summaries)", () => {
		act(() => {
			root?.render(
				<CreditUsageSection
					availableCredits={25}
					reservedCredits={6}
					totalCreditsUsed={14}
					operations={mockOperations}
				/>,
			);
		});

		// Available credits card
		expect(container.textContent).toContain("Saldo Tersedia");
		expect(container.textContent).toContain("25");

		// Reserved credits card (shown because > 0)
		expect(container.textContent).toContain("Sedang Direservasi");
		expect(container.textContent).toContain("6");

		// Total credits used
		expect(container.textContent).toContain("Total Kredit Digunakan");
		expect(container.textContent).toContain("14");

		// Stage breakdown summary
		expect(container.textContent).toContain("Codebase");
		expect(container.textContent).toContain("PRD");
		expect(container.textContent).toContain("AC");
		expect(container.textContent).toContain("Task");
	});

	it("hides reserved credits card when reserved credits is 0", () => {
		act(() => {
			root?.render(
				<CreditUsageSection
					availableCredits={30}
					reservedCredits={0}
					totalCreditsUsed={10}
					operations={mockOperations}
				/>,
			);
		});

		expect(container.textContent).toContain("Saldo Tersedia");
		expect(container.textContent).not.toContain("Sedang Direservasi");
	});

	it("renders operation rows with correct Indonesian status labels", () => {
		act(() => {
			root?.render(
				<CreditUsageSection
					availableCredits={25}
					reservedCredits={6}
					totalCreditsUsed={14}
					operations={mockOperations}
				/>,
			);
		});

		// Status labels required by brief
		expect(container.textContent).toContain("Berhasil");
		expect(container.textContent).toContain("Gagal");
		expect(container.textContent).toContain("Dilepas");
		expect(container.textContent).toContain("Direservasi");
		expect(container.textContent).toContain("Diproses");
		expect(container.textContent).toContain("Dikarantina");
		expect(container.textContent).toContain("Dikembalikan");

		// Activity and project labels
		expect(container.textContent).toContain("Generate PRD");
		expect(container.textContent).toContain("Generate AC");
		expect(container.textContent).toContain("Codebase analysis");
		expect(container.textContent).toContain("Generate Task");
		expect(container.textContent).toContain("Aplikasi Kasir Pro");
		expect(container.textContent).toContain("Marketplace B2B");
	});

	it("filters operation rows by stage and status", () => {
		act(() => {
			root?.render(
				<CreditUsageSection
					availableCredits={25}
					reservedCredits={6}
					totalCreditsUsed={14}
					operations={mockOperations}
				/>,
			);
		});

		const stageSelect = container.querySelector(
			"select[data-testid='filter-stage']",
		) as HTMLSelectElement | null;
		expect(stageSelect).not.toBeNull();

		// Filter by PRD stage
		act(() => {
			if (stageSelect) {
				stageSelect.value = "prd";
				stageSelect.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});

		const tbody = container.querySelector("tbody");
		expect(tbody).not.toBeNull();
		expect(tbody?.textContent).toContain("Generate PRD");
		expect(tbody?.textContent).not.toContain("Codebase analysis");
		expect(tbody?.textContent).not.toContain("Generate Task");

		// Filter by status "Gagal"
		const statusSelect = container.querySelector(
			"select[data-testid='filter-status']",
		) as HTMLSelectElement | null;
		expect(statusSelect).not.toBeNull();

		// Reset stage to all, set status to failed
		act(() => {
			if (stageSelect && statusSelect) {
				stageSelect.value = "all";
				stageSelect.dispatchEvent(new Event("change", { bubbles: true }));
				statusSelect.value = "failed";
				statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});

		expect(tbody?.textContent).toContain("Gagal");
		expect(tbody?.textContent).not.toContain("Berhasil");
		expect(tbody?.textContent).not.toContain("Dikembalikan");
	});

	it("opens detail modal with complexity metrics and cap indicator", () => {
		act(() => {
			root?.render(
				<CreditUsageSection
					availableCredits={25}
					reservedCredits={6}
					totalCreditsUsed={14}
					operations={mockOperations}
				/>,
			);
		});

		// Find detail button for op-4 (which has capApplied = true)
		const detailButtons = container.querySelectorAll<HTMLButtonElement>(
			"button[data-testid^='detail-btn-']",
		);
		expect(detailButtons.length).toBeGreaterThan(0);

		// Click detail button for op-4
		const op4Btn = container.querySelector<HTMLButtonElement>(
			"button[data-testid='detail-btn-op-4']",
		);
		expect(op4Btn).not.toBeNull();

		act(() => {
			op4Btn?.click();
		});

		// Modal should now be open with pricing version and complexity metrics
		expect(container.textContent).toContain("2026-09-20");
		expect(container.textContent).toContain("500"); // promptChars
		expect(container.textContent).toContain("5.000"); // prdSourceChars formatted with id-ID locale
		expect(container.textContent).toContain("15"); // taskCount
		expect(container.textContent).toContain("Batas Maksimum Diterapkan");

		// Close modal
		const closeBtn = container.querySelector<HTMLButtonElement>(
			"button[data-testid='modal-close-btn']",
		);
		expect(closeBtn).not.toBeNull();
		act(() => {
			closeBtn?.click();
		});

		expect(
			container.querySelector("button[data-testid='modal-close-btn']"),
		).toBeNull();
	});

	it("renders empty state copy when no operations exist", () => {
		act(() => {
			root?.render(
				<CreditUsageSection
					availableCredits={10}
					reservedCredits={0}
					totalCreditsUsed={0}
					operations={[]}
				/>,
			);
		});

		expect(container.textContent).toContain(
			"Belum ada riwayat penggunaan kredit",
		);
	});

	it("shows empty state when filter yields zero results and resets with reset button", () => {
		act(() => {
			root?.render(
				<CreditUsageSection
					availableCredits={25}
					reservedCredits={6}
					totalCreditsUsed={14}
					operations={mockOperations}
				/>,
			);
		});

		const stageSelect = container.querySelector(
			"select[data-testid='filter-stage']",
		) as HTMLSelectElement | null;
		const statusSelect = container.querySelector(
			"select[data-testid='filter-status']",
		) as HTMLSelectElement | null;

		// Filter by codebase stage AND failed status (which has 0 matches in mock data)
		act(() => {
			if (stageSelect && statusSelect) {
				stageSelect.value = "codebase";
				stageSelect.dispatchEvent(new Event("change", { bubbles: true }));
				statusSelect.value = "failed";
				statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});

		expect(container.textContent).toContain(
			"Tidak ada riwayat penggunaan kredit yang sesuai dengan filter yang dipilih",
		);

		// Reset button appears
		const resetBtnText = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent?.includes("Reset Filter"),
		);
		expect(resetBtnText).not.toBeUndefined();

		act(() => {
			resetBtnText?.click();
		});

		expect(container.querySelector("tbody")?.textContent).toContain(
			"Generate PRD",
		);
	});

	it("displays codebase complexity metrics (file count, bytes, dependencies) in detail modal", () => {
		act(() => {
			root?.render(
				<CreditUsageSection
					availableCredits={25}
					reservedCredits={6}
					totalCreditsUsed={14}
					operations={mockOperations}
				/>,
			);
		});

		// Op-3 has codebase metrics
		const op3Btn = container.querySelector<HTMLButtonElement>(
			"button[data-testid='detail-btn-op-3']",
		);
		expect(op3Btn).not.toBeNull();

		act(() => {
			op3Btn?.click();
		});

		expect(container.textContent).toContain("File Codebase");
		expect(container.textContent).toContain("45 file");
		expect(container.textContent).toContain("Ukuran Codebase");
		expect(container.textContent).toContain("150.000 bytes");
		expect(container.textContent).toContain("Dependensi");
		expect(container.textContent).toContain("12 paket");
	});
});

describe("CreditExhaustedModal with adaptive credit context", () => {
	let container: HTMLDivElement;
	let root: Root | null = null;

	beforeEach(() => {
		(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		if (root) {
			act(() => {
				root?.unmount();
			});
			root = null;
		}
		container?.remove();
	});

	it("displays required credits, available credits, and quote estimates when provided", () => {
		act(() => {
			root?.render(
				<CreditExhaustedModal
					isOpen={true}
					onClose={() => {}}
					errorMessage="Kredit tidak mencukupi untuk melanjutkan operasi ini."
					projectId="proj-1"
					stage="prd"
					requiredCredits={6}
					availableCredits={2}
					quote={{
						estimatedCredits: 4,
						maximumCredits: 6,
						pricingVersion: "2026-09-20",
					}}
				/>,
			);
		});

		expect(container.textContent).toContain("Kredit Habis");
		expect(container.textContent).toContain(
			"Kredit tidak mencukupi untuk melanjutkan operasi ini.",
		);
		expect(container.textContent).toContain("Kebutuhan Kredit:");
		expect(container.textContent).toContain("6 kredit");
		expect(container.textContent).toContain("Saldo Tersedia:");
		expect(container.textContent).toContain("2 kredit");
		expect(container.textContent).toContain("Estimasi: 4 kredit");
		expect(container.textContent).toContain("Maksimum: 6 kredit");
	});
});
