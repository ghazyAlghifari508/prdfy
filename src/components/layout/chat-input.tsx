import { Link, useNavigate } from "@tanstack/react-router";
import {
	Check,
	ChevronDown,
	FolderGit2,
	Monitor,
	Plus,
	Smartphone,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CreditExhaustedModal } from "@/components/chat/credit-exhausted-modal";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTypingPlaceholder } from "@/hooks/use-typing-placeholder";
import { useUserPlan } from "@/hooks/use-user-plan";
import { authClient } from "@/lib/auth-client";
import {
	getPendingSyncPayloadKey,
	type SyncPromptPayload,
} from "@/lib/codebase-sync";
import {
	HOME_DRAFT_DEBOUNCE_MS,
	MAX_PROMPT_LENGTH,
	MIN_PROMPT_LENGTH,
} from "@/lib/constants";
import { type OutputLanguage, SUPPORTED_LANGUAGES } from "@/lib/language";
import {
	clearHomeDraft,
	getAskLanguage,
	getHomeDraft,
	saveAskLanguage,
	saveAskPlatform,
	saveHomeDraft,
	saveSetupPrompt,
} from "@/lib/prompt-handoff";
import { cn } from "@/lib/utils";
import { PLAN_CREDITS } from "@/types/database";

// Home project-mode selector (unit-tested in ./-home-mode.test.ts).
// Greenfield keeps the existing Home → /ask/$id flow byte-identical;
// existing_codebase sends the mode with the prompt and routes to /codebase/$id.
export const HOME_PROJECT_MODE_OPTIONS = [
	{ id: "greenfield", label: "Produk baru" },
	{ id: "existing_codebase", label: "Codebase existing" },
] as const;

export type HomeProjectMode = (typeof HOME_PROJECT_MODE_OPTIONS)[number]["id"];

// Post-creation routing: existing-codebase enters the sync flow, everything
// else (including legacy responses without a mode) keeps the /ask/$id route.
export function decideHomePostCreationTarget(project: {
	id: string;
	projectMode?: string | null;
}): { to: "/ask/$id" | "/codebase/$id"; params: { id: string } } {
	if (project.projectMode === "existing_codebase") {
		return { to: "/codebase/$id", params: { id: project.id } };
	}
	return { to: "/ask/$id", params: { id: project.id } };
}

// Credit precheck gate: block only on a known-zero balance. Unknown or
// unlimited balances fail open here — the server still enforces with 403 at
// generate time.
export function shouldBlockProjectCreationOnCredits(
	remaining: number | "unlimited" | null | undefined,
): boolean {
	return remaining === 0;
}

interface ChatInputProps {
	className?: string;
	initialValue?: string;
	initialMobile?: boolean;
	prefillKey?: number;
}

export function ChatInput({
	className,
	initialValue,
	initialMobile,
	prefillKey,
}: ChatInputProps) {
	const [message, setMessage] = useState(() => getHomeDraft());
	const [focused, setFocused] = useState(false);
	const [isMobileMode, setIsMobileMode] = useState(false);
	const [projectMode, setProjectMode] = useState<HomeProjectMode>("greenfield");
	const [language, setLanguage] = useState<OutputLanguage>(() =>
		getAskLanguage(),
	);
	const [promptError, setPromptError] = useState("");

	const [creditsExhaustedMsg, setCreditsExhaustedMsg] = useState<string | null>(
		null,
	);

	// ponytail: shared TanStack Query hook — deduped across all components
	// that read /api/user/plan. 60s staleTime. Replaces manual fetch() calls.
	const { data: planData, refetch: refetchPlan } = useUserPlan();
	// ponytail: reactive shared session via nanostore — deduped with Navbar.
	const { data: session } = authClient.useSession();

	const navigate = useNavigate();

	useEffect(() => {
		if (initialValue !== undefined) {
			setMessage(initialValue);
			if (initialMobile !== undefined) setIsMobileMode(initialMobile);
		}
	}, [initialValue, initialMobile, prefillKey]);

	// ponytail: debounce keeps the home seed-prompt draft alive across
	// refresh, so a long product description isn't lost before send.
	useEffect(() => {
		const t = setTimeout(() => saveHomeDraft(message), HOME_DRAFT_DEBOUNCE_MS);
		return () => clearTimeout(t);
	}, [message]);

	const handleSend = async () => {
		if (!message.trim()) return;

		if (message.trim().length < MIN_PROMPT_LENGTH) {
			setPromptError(
				`Deskripsikan produkmu lebih detail (minimal ${MIN_PROMPT_LENGTH} karakter) agar AI bisa menghasilkan PRD yang berkualitas.`,
			);
			return;
		}
		setPromptError("");

		// Store model & platform preference alongside the prompt
		const originalMessage = message.trim();
		const enrichedPrompt = isMobileMode
			? `[Platform: Mobile App]\n${originalMessage}`
			: `[Platform: Web App]\n${originalMessage}`;

		saveSetupPrompt(enrichedPrompt);
		saveAskPlatform(isMobileMode ? "mobile" : "web");
		saveAskLanguage(language);
		// Save original message for display in chat bubble (without platform tags)
		sessionStorage.setItem("prdfy:original-message", originalMessage);

		// ponytail: use reactive session (shared nanostore with Navbar) instead
		// of a manual getSession() round-trip per send attempt.
		const isAuthenticated = !!session?.user?.id;

		if (!isAuthenticated) {
			// ponytail: back to home, not /ask, the project doesn't exist yet at this
			// point, so there is no /ask/$id to land on and no bare /ask route.
			navigate({ to: "/login", search: { redirect: "/" } });
			return;
		}

		// Pre-check credits before creating project — blocks at home page,
		// not after redirect to empty PRD/question page.
		try {
			const freshPlan = await refetchPlan();
			if (shouldBlockProjectCreationOnCredits(freshPlan.data?.remaining)) {
				setCreditsExhaustedMsg(
					"Kredit kamu sudah habis. Beli kredit untuk membuat proyek baru.",
				);
				return;
			}
		} catch {
			// If plan check fails, allow flow — server will block with 403 anyway
		}

		try {
			const res = await fetch("/api/projects", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					message: enrichedPrompt,
					language,
					projectMode,
				}),
			});
			const project = (await res.json().catch(() => ({}))) as {
				id?: string;
				error?: string;
				projectMode?: string | null;
				sync?: SyncPromptPayload;
			};
			if (!res.ok || !project.id)
				throw new Error(project.error || "Gagal membuat proyek");
			clearHomeDraft();
			// Existing-codebase enters the sync flow: stash the one-time sync
			// payload for /codebase/$id (consumed once to open the agent
			// modal). Greenfield keeps the exact /ask/$id navigation.
			const target = decideHomePostCreationTarget({
				id: project.id,
				projectMode: project.projectMode ?? projectMode,
			});
			if (target.to === "/codebase/$id" && project.sync) {
				try {
					sessionStorage.setItem(
						getPendingSyncPayloadKey(project.id),
						JSON.stringify(project.sync),
					);
				} catch {
					// Storage blocked/full — the codebase page falls back to
					// manual "Mulai sync", so creation still succeeds.
				}
			}
			navigate({ to: target.to, params: target.params });
		} catch (err) {
			console.error("Create project error:", err);
			setPromptError("Gagal membuat proyek. Coba lagi.");
		}
	};

	const typingPlaceholder = useTypingPlaceholder(isMobileMode, language);

	return (
		<>
			<div
				className={cn(
					"mx-auto flex w-full max-w-[728px] flex-col rounded-xl bg-charcoal p-1.5 shadow-[var(--shadow-surface)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
					focused ? "shadow-[var(--shadow-focus)]" : "",
					className,
				)}
			>
				<div className="flex flex-1 flex-col gap-3 rounded-[10px] bg-obsidian p-4">
					{/* Top row: Credit info + Mobile/Web toggle */}
					<div className="flex items-center justify-between px-2">
						<div className="flex items-center gap-3">
							<span className="font-inter text-[12px] font-[510] text-mist">
								{!planData?.authenticated
									? `${PLAN_CREDITS.free} Kredit Gratis`
									: `Sisa ${planData.remaining} Kredit`}
							</span>
							{(!planData?.authenticated || planData.plan !== "hengker") && (
								<Link
									to="/pricing"
									className="cursor-pointer rounded-[2px] px-2 py-0.5 font-inter text-[10px] font-[510] uppercase text-fog shadow-[var(--shadow-inset)] transition-colors duration-300 hover:bg-steel/70"
								>
									Upgrade
								</Link>
							)}
						</div>

						{/* Mobile / Web Segmented Control */}
						<div className="flex items-center gap-0.5 rounded-md bg-charcoal p-1 shadow-[var(--shadow-inset)]">
							<button
								type="button"
								id="platform-toggle-mobile-label"
								onClick={() => setIsMobileMode(true)}
								title="Generate PRD untuk Mobile App"
								className={cn(
									"flex items-center gap-1.5 rounded px-2.5 py-1 font-inter text-[11px] font-[510] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
									isMobileMode
										? "border border-iron/50 bg-iron text-snow"
										: "border border-transparent text-fog hover:text-snow",
								)}
							>
								<Smartphone size={12} />
								App
							</button>
							<button
								type="button"
								id="platform-toggle-web"
								onClick={() => setIsMobileMode(false)}
								title="Generate PRD untuk Web App"
								className={cn(
									"flex items-center gap-1.5 rounded px-2.5 py-1 font-inter text-[11px] font-[510] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
									!isMobileMode
										? "border border-iron/50 bg-iron text-snow"
										: "border border-transparent text-fog hover:text-snow",
								)}
							>
								<Monitor size={12} />
								Web
							</button>
						</div>
					</div>

					{/* Project mode selector: Produk baru | Codebase existing */}
					<div className="flex items-center gap-0.5 self-start rounded-md bg-charcoal p-1 shadow-[var(--shadow-inset)]">
						{HOME_PROJECT_MODE_OPTIONS.map((option) => {
							const active = projectMode === option.id;
							const Icon = option.id === "greenfield" ? Plus : FolderGit2;
							return (
								<button
									key={option.id}
									type="button"
									id={
										option.id === "greenfield"
											? "home-mode-greenfield"
											: "home-mode-existing-codebase"
									}
									onClick={() => setProjectMode(option.id)}
									title={
										option.id === "greenfield"
											? "Buat PRD dari ide produk baru"
											: "Rencanakan fitur untuk codebase yang sudah ada"
									}
									aria-pressed={active}
									className={cn(
										"flex items-center gap-1.5 rounded px-2.5 py-1 font-inter text-[11px] font-[510] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
										active
											? "border border-iron/50 bg-iron text-snow"
											: "border border-transparent text-fog hover:text-snow",
									)}
								>
									<Icon size={12} />
									{option.label}
								</button>
							);
						})}
					</div>

					{/* Main input area */}
					<div className="relative flex flex-col rounded-md bg-charcoal shadow-[var(--shadow-inset)] transition-shadow duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus-within:shadow-[var(--shadow-focus)]">
						<textarea
							value={message}
							onChange={(e) => setMessage(e.target.value)}
							onFocus={() => setFocused(true)}
							onBlur={() => setFocused(false)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									handleSend();
								}
							}}
							placeholder={typingPlaceholder}
							className="w-full resize-none border-none bg-transparent px-3 pb-2 pt-3 font-inter text-[15px] text-snow outline-none placeholder:text-slate"
							style={{ caretColor: "var(--text-primary)" }}
							rows={3}
						/>

						{/* Bottom row inside input area */}
						<div className="flex items-center justify-between gap-3 px-3 pb-3 pt-1">
							{/* Left side: Output language selector dropdown */}
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										id="output-language-selector-btn"
										title="Pilih bahasa output generasi AI"
										className="flex items-center gap-1.5 rounded-md px-2 py-1 font-inter text-[11px] font-[510] text-mist transition-all duration-200 hover:bg-steel/50 hover:text-snow focus:outline-none"
									>
										<span className="font-mono text-[10px] font-semibold text-fog">
											{language === "en" ? "EN" : "ID"}
										</span>
										<span>
											{language === "en" ? "English" : "Bahasa Indonesia"}
										</span>
										<ChevronDown size={11} className="text-slate" />
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="start"
									side="bottom"
									className="min-w-[170px] border-steel/60 bg-obsidian/95 p-1 backdrop-blur"
								>
									{SUPPORTED_LANGUAGES.map((langOpt) => (
										<DropdownMenuItem
											key={langOpt.id}
											onClick={() => {
												setLanguage(langOpt.id);
												saveAskLanguage(langOpt.id);
											}}
											className={cn(
												"flex cursor-pointer items-center justify-between px-2.5 py-2 font-inter text-xs transition-colors",
												language === langOpt.id
													? "bg-steel font-[510] text-snow"
													: "text-mist hover:bg-white/5 hover:text-snow",
											)}
										>
											<span className="flex items-center gap-2">
												<span className="font-mono text-[10px] font-semibold text-fog">
													{langOpt.shortLabel}
												</span>
												<span>{langOpt.label}</span>
											</span>
											{language === langOpt.id && (
												<Check size={13} className="text-snow" />
											)}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>

							{/* Right side: Character counter & Submit */}
							<div className="flex items-center gap-3">
								<span
									className={cn(
										"font-inter text-[12px]",
										message.trim().length > 0 &&
											message.trim().length < MIN_PROMPT_LENGTH
											? "text-crimson"
											: "text-fog",
									)}
								>
									{message.length.toLocaleString()}/
									{MAX_PROMPT_LENGTH.toLocaleString()}
								</span>
								<button
									type="button"
									id="hero-send-btn"
									onClick={handleSend}
									disabled={!message.trim()}
									aria-label="Kirim prompt ide produk"
									className={cn(
										"flex h-9 w-9 items-center justify-center rounded-md transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]",
										message.trim()
											? "btn-primary hover:brightness-105"
											: "bg-steel/40 text-slate",
									)}
								>
									<svg
										width="14"
										height="14"
										viewBox="0 0 14 14"
										fill="none"
										xmlns="http://www.w3.org/2000/svg"
										role="img"
										aria-label="Kirim"
									>
										<title>Kirim</title>
										<path
											d="M7 11.5V2.5M7 2.5L2.5 7M7 2.5L11.5 7"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								</button>
							</div>
						</div>
					</div>

					{/* Prompt error message */}
					{promptError && (
						<div className="px-3 pb-2">
							<p className="animate-in fade-in slide-in-from-top-1 font-inter text-[12px] text-crimson duration-200">
								{promptError}
							</p>
						</div>
					)}
				</div>
			</div>

			<CreditExhaustedModal
				isOpen={!!creditsExhaustedMsg}
				onClose={() => setCreditsExhaustedMsg(null)}
				errorMessage={creditsExhaustedMsg || ""}
				projectId=""
				stage="prd"
			/>
		</>
	);
}
