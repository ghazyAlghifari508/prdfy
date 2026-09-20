"use client";

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	clearOnboardingState,
	getOnboardingState,
	saveOnboardingState,
} from "@/lib/prompt-handoff";
import { useAuthStore } from "@/store";

const ROLES = [
	{ value: "pm", label: "Product Manager" },
	{ value: "developer", label: "Software Developer" },
	{ value: "founder", label: "Startup Founder / CTO" },
	{ value: "designer", label: "UX/UI Designer" },
	{ value: "student", label: "Mahasiswa / Fresh Graduate" },
	{ value: "other", label: "Lainnya" },
];

const GOALS = [
	{ value: "documentation", label: "Dokumentasi produk" },
	{ value: "team_blueprint", label: "Blueprint tim development" },
	{ value: "pitching", label: "Pitching ke investor / stakeholder" },
	{ value: "learning", label: "Belajar membuat PRD" },
	{ value: "rapid_shipping", label: "Rapid product shipping" },
];

export function OnboardingForm() {
	const restored = useRef(getOnboardingState()).current;
	const stepInit = restored?.step ?? 1;
	const [step, setStep] = useState<number>(
		stepInit < 1 || stepInit > 3 ? 1 : stepInit,
	);
	const [fullName, setFullName] = useState(restored?.fullName ?? "");
	const [role, setRole] = useState(restored?.role ?? "");
	const [tujuan, setTujuan] = useState<string[]>(restored?.goals ?? []);
	// ponytail: 200ms debounce snapshots the wizard so a refresh mid-onboarding
	// restores step + name + role + goals instead of wiping them to step 1.
	useEffect(() => {
		const t = setTimeout(
			() => saveOnboardingState({ step, fullName, role, goals: tujuan }),
			200,
		);
		return () => clearTimeout(t);
	}, [step, fullName, role, tujuan]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const navigate = useNavigate();
	const setUser = useAuthStore((s) => s.setUser);

	const toggleTujuan = (value: string) => {
		setTujuan((prev) =>
			prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
		);
	};

	const handleNext = () => {
		setError(null);
		if (step === 1 && !fullName.trim()) {
			setError("Nama wajib diisi");
			return;
		}
		if (step === 2 && !role) {
			setError("Pilih peran kamu");
			return;
		}
		setStep((s) => s + 1);
	};

	const handleSubmit = async () => {
		if (tujuan.length === 0) {
			setError("Pilih minimal satu tujuan");
			return;
		}

		setLoading(true);
		setError(null);

		try {
			const response = await fetch("/api/auth/onboarding", {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					fullName,
					role,
					goals: tujuan,
				}),
			});

			const result = await response.json().catch(() => null);

			if (response.status === 401) {
				navigate({ to: "/login", replace: true });
				return;
			}

			if (!response.ok || !result?.user) {
				setError(result?.message ?? "Gagal menyimpan onboarding.");
				return;
			}

			setUser({ id: result.user.id, email: result.user.email });
			clearOnboardingState();
			window.location.assign("/");
		} catch {
			setError("Gagal menyimpan onboarding.");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="w-full max-w-lg space-y-8">
			<div className="text-center">
				<h1 className="font-[510] text-3xl font-bold">
					{step === 1 && "Siapa nama kamu?"}
					{step === 2 && "Apa peran kamu?"}
					{step === 3 && "Apa tujuan kamu?"}
				</h1>
				<p className="mt-2 text-(--text-secondary)">
					{step === 1 && "Kami akan menyapa kamu dengan nama ini"}
					{step === 2 && "Supaya kami bisa menyesuaikan pengalaman"}
					{step === 3 && "Bisa pilih lebih dari satu"}
				</p>
			</div>

			{step === 1 && (
				<div className="space-y-4">
					<Input
						placeholder="Nama lengkap kamu"
						value={fullName}
						onChange={(e) => {
							setFullName(e.target.value);
							setError(null);
						}}
						onKeyDown={(e) => e.key === "Enter" && handleNext()}
						autoFocus
					/>
				</div>
			)}

			{step === 2 && (
				<div className="grid gap-3">
					{ROLES.map((r) => (
						<button
							key={r.value}
							type="button"
							onClick={() => {
								setRole(r.value);
								setError(null);
							}}
							className={`rounded-lg border p-4 text-left transition-all ${
								role === r.value
									? "border-primary-black btn-primary"
									: "border-(--border-subtle) hover:border-primary-black/30"
							}`}
						>
							{r.label}
						</button>
					))}
				</div>
			)}

			{step === 3 && (
				<div className="grid gap-3">
					{GOALS.map((g) => (
						<button
							key={g.value}
							type="button"
							onClick={() => toggleTujuan(g.value)}
							className={`rounded-lg border p-4 text-left transition-all ${
								tujuan.includes(g.value)
									? "border-primary-black btn-primary"
									: "border-(--border-subtle) hover:border-primary-black/30"
							}`}
						>
							{g.label}
						</button>
					))}
				</div>
			)}

			{error && (
				<div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
					{error}
				</div>
			)}

			<div className="flex items-center gap-3">
				<div className="flex flex-1 gap-2">
					{[1, 2, 3].map((s) => (
						<div
							key={s}
							className={`h-1 flex-1 rounded-full transition-all ${
								s <= step ? "bg-[var(--btn-bg)]" : "bg-(--bg-surface)"
							}`}
						/>
					))}
				</div>
				{step < 3 ? (
					<Button onClick={handleNext}>Lanjut</Button>
				) : (
					<Button onClick={handleSubmit} isLoading={loading}>
						Selesai
					</Button>
				)}
			</div>
		</div>
	);
}
