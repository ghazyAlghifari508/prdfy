"use client";

import { useNavigate } from "@tanstack/react-router";
import { Cloud, Database, Layers, Palette, Rocket } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	CODEBASE_ASK_HANDOFF_SAVE_TIMEOUT_MS,
} from "@/lib/constants";
import {
	getAskLanguage,
	getAskPlatform,
	getAskState,
	getSetupPrompt,
	saveAskState,
	savePendingPrdPrompt,
} from "@/lib/prompt-handoff";
import {
	BACKEND_OPTIONS,
	DATABASE_OPTIONS,
	DEPLOYMENT_MOBILE_OPTIONS,
	DEPLOYMENT_OPTIONS,
	FRONTEND_MOBILE_OPTIONS,
	FRONTEND_WEB_OPTIONS,
	FULLSTACK_FRAMEWORK_OPTIONS,
	FULLSTACK_MOBILE_OPTIONS,
} from "@/lib/stack-data";
import { type NonTechAnswer, QuestionCard } from "./question-card";
import { StackDropdown } from "./stack-dropdown";

interface AskQuestion {
	id: string;
	question: string;
	type: "select" | "text" | "multiselect";
	options?: string[];
}

interface TechAnswers {
	frontend?: string;
	backend?: string;
	fullstackFramework?: string;
	database?: string;
	deployment?: string;
}

interface AskFlowProps {
	projectId: string;
	projectName: string;
	/** Existing-codebase projects persist the Ask handoff server-side.
	 *  Absent/unknown behaves as greenfield (sessionStorage only). */
	projectMode?: string | null;
	initialHandoff?: {
		projectId: string;
		answers?: Array<{ question: string; answer: string }>;
		compiledPrompt?: string;
		state?: {
			prompt?: string;
			platform?: "web" | "mobile";
			session?: 1 | 2 | 3;
			questions?: AskQuestion[];
			nonTechAnswers?: Record<string, NonTechAnswer>;
			techAnswers?: TechAnswers;
			skippedTech?: string[];
		};
	} | null;
}

export function AskFlow({
	projectId,
	projectName,
	projectMode: _projectMode,
	initialHandoff,
}: AskFlowProps) {
	const navigate = useNavigate();
	const promptRef = useRef("");
	const hasFetched = useRef(false);
	const [session, setSession] = useState<1 | 2>(1);
	const [isLoadingQuestions, setIsLoadingQuestions] = useState(true);
	const [loadError, setLoadError] = useState("");
	const [questions, setQuestions] = useState<AskQuestion[]>([]);
	const [nonTechAnswers, setNonTechAnswers] = useState<
		Record<string, NonTechAnswer>
	>({});
	const [techAnswers, setTechAnswers] = useState<TechAnswers>({});
	const [skippedTech, setSkippedTech] = useState<Set<string>>(new Set());
	const [platform, setPlatform] = useState<"web" | "mobile">("web");

	const toggleSkipTech = (field: string) => {
		setSkippedTech((prev) => {
			const next = new Set(prev);
			if (next.has(field)) next.delete(field);
			else {
				next.add(field);
				setTechAnswers((p) => ({ ...p, [field]: undefined }));
			}
			return next;
		});
	};

	// ponytail: deps kosong disengaja. `useNavigate()` bikin objek baru tiap render,
	// kalau masuk dep array, effect re-run terus dan cleanup abort membunuh fetch
	// yang sedang jalan, sementara guard hasFetched memblokir fetch ulang → layar
	// "Gagal memuat pertanyaan." padahal tidak ada error. Fetch cukup sekali per
	// mount; hasFetched menjaga StrictMode double-invoke.
	// biome-ignore lint/correctness/useExhaustiveDependencies: lihat catatan di atas
	useEffect(() => {
		if (hasFetched.current) return;
		hasFetched.current = true;

		// Restore state persisted across refresh/hard-refresh. If a saved set
		// exists for THIS project, replay it and skip regenerating questions.
		const saved = getAskState(projectId);
		if (saved) {
			promptRef.current = saved.prompt;
			setPlatform(saved.platform);
			setSession(saved.session);
			setQuestions(saved.questions);
			setNonTechAnswers(saved.nonTechAnswers);
			setTechAnswers(saved.techAnswers);
			setSkippedTech(new Set(saved.skippedTech ?? []));
			setIsLoadingQuestions(false);
			return;
		}

		// Helper to apply state snapshot from server
		const applyState = (st: unknown): boolean => {
			if (!st || typeof st !== "object") return false;
			const s = st as Record<string, unknown>;
			if (typeof s.prompt === "string" && s.prompt) {
				promptRef.current = s.prompt;
			}
			if (s.platform === "web" || s.platform === "mobile") {
				setPlatform(s.platform);
			}
			if (s.session === 1 || s.session === 2) {
				setSession(s.session);
			} else if (s.session === 3) {
				setSession(2);
			}
			if (s.nonTechAnswers && typeof s.nonTechAnswers === "object") {
				setNonTechAnswers(s.nonTechAnswers as Record<string, NonTechAnswer>);
			}
			if (s.techAnswers && typeof s.techAnswers === "object") {
				const t = s.techAnswers as Record<string, unknown>;
				setTechAnswers({
					...(typeof t.frontend === "string" ? { frontend: t.frontend } : {}),
					...(typeof t.backend === "string" ? { backend: t.backend } : {}),
					...(typeof t.fullstackFramework === "string"
						? { fullstackFramework: t.fullstackFramework }
						: {}),
					...(typeof t.database === "string" ? { database: t.database } : {}),
					...(typeof t.deployment === "string"
						? { deployment: t.deployment }
						: {}),
				});
			}
			if (Array.isArray(s.skippedTech)) {
				setSkippedTech(
					new Set(
						s.skippedTech.filter((x): x is string => typeof x === "string"),
					),
				);
			}
			if (Array.isArray(s.questions) && s.questions.length > 0) {
				const validTypes = ["select", "text", "multiselect"];
				const validQuestions = s.questions.filter((q): q is AskQuestion => {
					if (!q || typeof q !== "object") return false;
					const cand = q as Partial<AskQuestion>;
					if (
						typeof cand.id !== "string" ||
						typeof cand.question !== "string"
					) {
						return false;
					}
					if (!validTypes.includes(cand.type ?? "")) return false;
					if (cand.options !== undefined) {
						if (!Array.isArray(cand.options)) return false;
						if (!cand.options.every((o) => typeof o === "string")) return false;
					}
					return true;
				});
				if (validQuestions.length > 0) {
					setQuestions(validQuestions);
					setIsLoadingQuestions(false);
					return true;
				}
			}
			return false;
		};

		// Authoritative server handoff: survives tab close, History navigation,
		// and multi-device access where sessionStorage cannot.
		const restoreFromServer = async (): Promise<boolean> => {
			if (initialHandoff?.state) {
				if (applyState(initialHandoff.state)) return true;
			}
			try {
				const res = await fetch("/api/ask/options", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ projectId, action: "get-handoff" }),
				});
				if (!res.ok) return false;
				const data = (await res.json().catch(() => null)) as {
					handoff?: { state?: unknown } | null;
				};
				if (data?.handoff?.state) {
					return applyState(data.handoff.state);
				}
				return false;
			} catch {
				return false;
			}
		};

		const run = async () => {
			if (await restoreFromServer()) return;

			// Prompt fallback chain: promptRef (from server handoff) -> sessionStorage -> projectName
			const prompt = promptRef.current || getSetupPrompt() || projectName;
			if (!prompt) {
				navigate({ to: "/", replace: true });
				return;
			}
			promptRef.current = prompt;
			setPlatform(getAskPlatform());

			try {
				const res = await fetch("/api/ask/options", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						projectId,
						prompt,
						platform: getAskPlatform(),
						language: getAskLanguage(),
					}),
				});
				const data = (await res.json().catch(() => ({}))) as {
					questions?: AskQuestion[];
					error?: string;
				};
				if (!res.ok) throw new Error(data.error || "Gagal memuat pertanyaan");
				setQuestions(data.questions ?? []);
			} catch (err) {
				console.error("Fetch ask options error:", err);
				setLoadError(
					err instanceof Error ? err.message : "Gagal memuat pertanyaan",
				);
			} finally {
				setIsLoadingQuestions(false);
			}
		};
		void run();
	}, []);

	// Persist across refresh/hard-refresh: write state whenever it changes.
	// Only once questions exist, avoids persisting an empty placeholder.
	useEffect(() => {
		if (questions.length === 0 || !promptRef.current) return;
		saveAskState({
			projectId,
			prompt: promptRef.current,
			platform,
			session,
			questions,
			nonTechAnswers,
			skippedTech: [...skippedTech],
			techAnswers,
		});

		// Debounced server auto-save so answers survive tab close & multi-device
		const timer = setTimeout(() => {
			void fetch("/api/ask/options", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					projectId,
					action: "save-handoff",
					handoff: {
						projectId,
						answers: [],
						state: {
							prompt: promptRef.current,
							platform,
							session,
							questions,
							nonTechAnswers,
							techAnswers,
							skippedTech: [...skippedTech],
						},
					},
				}),
			}).catch((err) => {
				console.error("Auto-save ask handoff failed:", err);
			});
		}, 600);

		return () => clearTimeout(timer);
	}, [
		questions,
		nonTechAnswers,
		techAnswers,
		skippedTech,
		session,
		platform,
		projectId,
	]);

	const fullstackDisabled = Boolean(
		techAnswers.frontend ||
			techAnswers.backend ||
			skippedTech.has("frontend") ||
			skippedTech.has("backend"),
	);
	const feBeDisabled = Boolean(
		techAnswers.fullstackFramework || skippedTech.has("fullstackFramework"),
	);
	const frontendOptions =
		platform === "mobile" ? FRONTEND_MOBILE_OPTIONS : FRONTEND_WEB_OPTIONS;
	const fullstackOptions =
		platform === "mobile"
			? FULLSTACK_MOBILE_OPTIONS
			: FULLSTACK_FRAMEWORK_OPTIONS;
	const deploymentOptions =
		platform === "mobile" ? DEPLOYMENT_MOBILE_OPTIONS : DEPLOYMENT_OPTIONS;

	const answeredCount = Object.values(nonTechAnswers).filter(
		(a) => a.value || a.skipped,
	).length;
	const allNonTechAnswered =
		questions.length > 0 &&
		questions.every((q) => {
			const a = nonTechAnswers[q.id];
			return a && (a.value || a.skipped);
		});
	// ponytail: every tech field is skippable: Lewati = undefined = "Biarkan AI
	// yang memilih" in submit(). No field is mandatory; Generate PRD stays enabled
	// so non-technical users can let the AI pick the whole stack.
	const allTechAnswered = true;

	const submit = async (tech: TechAnswers) => {
		const isEn = getAskLanguage() === "en";
		const skipLabel = isEn ? "(Let AI decide)" : "(Biarkan AI yang memilih)";
		const defaultChoice = isEn ? "Let AI decide" : "Biarkan AI yang memilih";
		const fullstackDefault = isEn
			? "Not used / Let AI decide"
			: "Tidak dipakai / Biarkan AI yang memilih";

		const nonTechLines = questions.map((q) => {
			const a = nonTechAnswers[q.id];
			if (!a || a.skipped || !a.value) return `- ${q.question}: ${skipLabel}`;
			return `- ${q.question}: ${a.value}`;
		});

		const platformLabel = platform === "mobile" ? "Mobile App" : "Web App";
		let compiledPrompt = isEn
			? `Please generate a PRD with the following specifications:

[Platform: ${platformLabel}]
${promptRef.current}

--- Non-Technical Preferences ---
${nonTechLines.join("\n")}

--- Technical Preferences ---
Frontend: ${tech.frontend || defaultChoice}
Backend: ${tech.backend || defaultChoice}
Fullstack Framework: ${tech.fullstackFramework || fullstackDefault}
Database: ${tech.database || defaultChoice}
Deployment: ${tech.deployment || defaultChoice}`
			: `Tolong buatkan PRD dengan spesifikasi berikut:

[Platform: ${platformLabel}]
${promptRef.current}

--- Preferensi Non-Teknis ---
${nonTechLines.join("\n")}

--- Preferensi Teknis ---
Frontend: ${tech.frontend || defaultChoice}
Backend: ${tech.backend || defaultChoice}
Fullstack Framework: ${tech.fullstackFramework || fullstackDefault}
Database: ${tech.database || defaultChoice}
Deployment: ${tech.deployment || defaultChoice}`;

		savePendingPrdPrompt(compiledPrompt, "auto", projectName);
		// Authoritative server handoff: survives refresh and multi-device access.
		// Best-effort with a timeout — the save must never stall navigation:
		// abort/timeout/failure all fall through safely.
		const ctrl = new AbortController();
		const timer = setTimeout(
			() => ctrl.abort(),
			CODEBASE_ASK_HANDOFF_SAVE_TIMEOUT_MS,
		);
		try {
			const skipLabel = isEn ? "(Let AI decide)" : "(Biarkan AI yang memilih)";
			const answers = questions.map((q) => {
				const a = nonTechAnswers[q.id];
				const picked =
					a && !a.skipped
						? Array.isArray(a.values) && a.values.length > 0
							? a.values.join(", ")
							: (a.value ?? "")
						: "";
				return {
					question: q.question,
					answer: picked || skipLabel,
				};
			});
			await fetch("/api/ask/options", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				signal: ctrl.signal,
				body: JSON.stringify({
					projectId,
					action: "save-handoff",
					handoff: {
						answers,
						compiledPrompt,
						state: {
							prompt: promptRef.current,
							platform,
							session,
							questions: questions.map((q) => ({
								id: q.id,
								question: q.question,
								type: q.type,
								...(q.options ? { options: q.options } : {}),
							})),
							nonTechAnswers,
							techAnswers: tech,
							skippedTech: [...skippedTech],
						},
					},
				}),
			});
		} catch (err) {
			console.warn("Ask handoff save skipped:", err);
		} finally {
			clearTimeout(timer);
		}
		navigate({ to: "/prd/$id", params: { id: projectId } });
	};

	if (isLoadingQuestions) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 bg-onyx">
				<div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo border-t-transparent" />
				<p className="font-inter text-sm text-fog">Menyusun pertanyaan...</p>
			</div>
		);
	}

	if (loadError || questions.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 text-center">
				<p className="font-inter text-fog">
					{loadError || "Gagal memuat pertanyaan."}
				</p>
				<button
					type="button"
					onClick={() => navigate({ to: "/" })}
					className="btn-primary rounded-md px-4 py-2 min-h-[44px] inline-flex items-center justify-center font-inter text-sm"
				>
					Kembali ke Home
				</button>
			</div>
		);
	}

	return (
		<div className="hide-scrollbar mx-auto flex-1 w-full overflow-y-auto bg-onyx min-h-0">
			<div className="mx-auto max-w-3xl lg:max-w-4xl px-4 sm:px-6 py-6 sm:py-12">
				<div className="mb-8 flex items-center justify-between">
					<div>
						<p className="font-inter text-xs uppercase tracking-wide text-fog">
							Sesi {session} dari 2
						</p>
						<h1
							className="font-inter text-2xl font-[510]"
							style={{ color: "var(--text-primary)" }}
						>
							{session === 1 ? "Ceritakan lebih lanjut" : "Preferensi Teknis"}
						</h1>
					</div>
					{session === 1 && (
						<span className="font-inter text-sm text-fog">
							{answeredCount}/{questions.length}
						</span>
					)}
				</div>

				{session === 1 ? (
					<div className="space-y-4 pb-8">
						<p className="font-inter text-xs text-fog italic">
							Pilih &ldquo;Lewati&rdquo; jika tidak yakin, AI akan menentukan
							yang terbaik berdasarkan kebutuhan aplikasi Anda.
						</p>
						{questions.map((q) => (
							<QuestionCard
								key={q.id}
								question={q.question}
								type={q.type}
								options={q.options}
								answer={nonTechAnswers[q.id]}
								onAnswer={(answer) =>
									setNonTechAnswers((prev) => ({ ...prev, [q.id]: answer }))
								}
							/>
						))}
						<div className="flex justify-end pt-2">
							<button
								type="button"
								disabled={!allNonTechAnswered}
								onClick={() => setSession(2)}
								className="btn-primary rounded-md px-6 py-2.5 min-h-[44px] inline-flex items-center justify-center font-inter text-sm font-[510] disabled:opacity-40 disabled:cursor-not-allowed"
							>
								Lanjut
							</button>
						</div>
					</div>
				) : (
					<div className="space-y-6 pb-8">
						<p className="font-inter text-xs text-fog italic">
							Pilih &ldquo;Gunakan Rekomendasi AI&rdquo; jika tidak yakin, AI
							akan memilih stack yang paling sesuai untuk aplikasi Anda.
						</p>
						<div className="grid gap-4 sm:grid-cols-2">
							<StackDropdown
								label="Frontend"
								subtitle="UI & tampilan user"
								icon={Palette}
								accent="#5e6ad2"
								placeholder="Pilih frontend..."
								options={frontendOptions}
								value={techAnswers.frontend}
								disabled={feBeDisabled}
								skipped={skippedTech.has("frontend")}
								allowSkip
								onChange={(v) =>
									setTechAnswers((prev) => ({ ...prev, frontend: v }))
								}
								onToggleSkip={() => toggleSkipTech("frontend")}
							/>
							<StackDropdown
								label="Backend"
								subtitle="Logic & API server"
								icon={Cloud}
								accent="#2dd4a7"
								placeholder="Pilih backend..."
								options={BACKEND_OPTIONS}
								value={techAnswers.backend}
								disabled={feBeDisabled}
								skipped={skippedTech.has("backend")}
								allowSkip
								onChange={(v) =>
									setTechAnswers((prev) => ({ ...prev, backend: v }))
								}
								onToggleSkip={() => toggleSkipTech("backend")}
							/>
							<StackDropdown
								label={
									platform === "mobile"
										? "Mobile + Backend"
										: "Fullstack Framework"
								}
								subtitle={
									platform === "mobile"
										? "Mobile FE + backend jadi satu"
										: "Frontend + backend jadi satu"
								}
								icon={Layers}
								accent="#e879a6"
								placeholder="Pilih framework..."
								options={fullstackOptions}
								value={techAnswers.fullstackFramework}
								disabled={fullstackDisabled}
								skipped={skippedTech.has("fullstackFramework")}
								allowSkip
								onChange={(v) =>
									setTechAnswers((prev) => ({ ...prev, fullstackFramework: v }))
								}
								onToggleSkip={() => toggleSkipTech("fullstackFramework")}
							/>
							<StackDropdown
								label="Database"
								subtitle="Penyimpanan data"
								icon={Database}
								accent="#f5b544"
								placeholder="Pilih database..."
								options={DATABASE_OPTIONS}
								value={techAnswers.database}
								disabled={false}
								skipped={skippedTech.has("database")}
								allowSkip
								onChange={(v) =>
									setTechAnswers((prev) => ({ ...prev, database: v }))
								}
								onToggleSkip={() => toggleSkipTech("database")}
							/>
							<StackDropdown
								label="Deployment"
								subtitle="Hosting & infra"
								icon={Rocket}
								accent="#a78bfa"
								placeholder="Pilih platform..."
								options={deploymentOptions}
								value={techAnswers.deployment}
								disabled={false}
								skipped={skippedTech.has("deployment")}
								allowSkip
								dropUp
								onChange={(v) =>
									setTechAnswers((prev) => ({ ...prev, deployment: v }))
								}
								onToggleSkip={() => toggleSkipTech("deployment")}
							/>
						</div>

						<div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border-subtle) pt-6">
							<button
								type="button"
								onClick={() => setSession(1)}
								className="font-inter text-sm text-fog hover:text-snow"
							>
								Kembali
							</button>
							<button
								type="button"
								disabled={!allTechAnswered}
								onClick={() => void submit(techAnswers)}
								className="btn-primary rounded-md px-6 py-2.5 font-inter text-sm font-[510] disabled:opacity-40 disabled:cursor-not-allowed"
							>
								Generate PRD
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
