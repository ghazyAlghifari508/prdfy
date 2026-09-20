"use client";

import {
	Link,
	useLocation,
	useMatches,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import {
	ArrowRight,
	LogOut,
	Menu,
	MessageSquare,
	Settings,
	Shield,
	User,
	X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useUserPlan } from "@/hooks/use-user-plan";
import { authClient } from "@/lib/auth-client";
import { useChatStore, useUIStore } from "@/store";
import { FlowStepNav, getFlowStepCta, routeToStep } from "./flow-step-nav";

export function Navbar() {
	const { data: session, isPending: isLoading } = authClient.useSession();
	const user =
		session?.user?.id && session.user.email
			? { id: session.user.id, email: session.user.email }
			: null;
	const [isDropdownOpen, setIsDropdownOpen] = useState(false);
	const [isStepLoading, setIsStepLoading] = useState(false);
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
	const isGeneratingPRD = useChatStore((s) => s.isGeneratingPRD);
	const hasStreamingPRDContent = useChatStore((s) => !!s.streamingPRDContent);
	const isGeneratingAC = useChatStore((s) => s.isGeneratingAC);
	const router = useRouter();
	const navigate = useNavigate();
	const pathname = useLocation({ select: (l) => l.pathname });
	const [, startTransition] = useTransition();
	// Single source of truth: reuse routeToStep for route-based actions
	const routeStep = routeToStep(pathname);
	const _isWorkspace = routeStep !== "prd";
	// Honest stepper: DB step via loader when available, fallback to route
	const projectNavData = useMatches({
		select: (matches) => {
			for (let i = matches.length - 1; i >= 0; i--) {
				const data = matches[i].loaderData as
					| { step?: string | null; taskStatus?: string | null }
					| undefined;
				if (
					data &&
					(typeof data.step === "string" ||
						typeof data.taskStatus === "string" ||
						data.step === null)
				) {
					return {
						step: data.step ?? null,
						taskStatus: data.taskStatus ?? null,
					};
				}
			}
			return null;
		},
	});
	const flowCta = getFlowStepCta(routeStep, projectNavData?.step);
	const { data: userPlanData } = useUserPlan();
	const plan = userPlanData?.plan ?? "free";
	const isFree = plan === "free";
	// FlowStepNav pages = PRD/AC/Task/Kanban (workspace)
	const isFlowStepRoute =
		pathname.startsWith("/ask/") ||
		pathname.startsWith("/prd/") ||
		pathname.startsWith("/ac/") ||
		pathname.startsWith("/task/") ||
		pathname.startsWith("/kanban/");

	const showToast = useUIStore((s) => s.showToast);

	// Extract projectId from route path
	const projectId = pathname.split("/")[2];

	const handleStepAc = async () => {
		if (!projectId || isStepLoading) return;
		setIsStepLoading(true);
		try {
			const res = await fetch(`/api/projects/${projectId}/step`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ step: "ac" }),
			});
			if (!res.ok) throw new Error("Gagal memperbarui tahap proyek");
			startTransition(() => {
				navigate({ to: "/ac/$id", params: { id: projectId } });
			});
		} catch (err) {
			console.error("Step to AC failed:", err);
			showToast("Gagal lanjut ke Acceptance Criteria.", "error");
		} finally {
			setIsStepLoading(false);
		}
	};

	const handleStepTask = async () => {
		if (!projectId || isStepLoading) return;
		setIsStepLoading(true);
		try {
			const res = await fetch(`/api/projects/${projectId}/step`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ step: "task" }),
			});
			if (!res.ok) throw new Error("Gagal memperbarui tahap proyek");
			startTransition(() => {
				navigate({ to: "/task/$id", params: { id: projectId } });
			});
		} catch (err) {
			console.error("Step to Task failed:", err);
			showToast("Gagal lanjut ke Task.", "error");
		} finally {
			setIsStepLoading(false);
		}
	};

	const handleLogout = async () => {
		try {
			await authClient.signOut();
			navigate({ to: "/login" });
			router.invalidate();
		} catch (err) {
			console.error("[navbar] logout failed", err);
			showToast("Gagal logout. Coba lagi.", "error");
		}
	};

	return (
		<nav className="fixed left-0 right-0 top-0 z-40 h-14 border-b border-graphite bg-charcoal/95">
			<div className="mx-auto flex h-full max-w-[1200px] items-center px-6">
				{/* Left: Project Menu (on Task route) + logo */}
				<div className="flex items-center gap-2.5 shrink-0 md:w-[220px]">
					{routeStep === "task" && projectId && (
						<button
							type="button"
							onClick={() => useUIStore.getState().setProjectDrawerOpen(true)}
							className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-graphite/60 bg-transparent text-fog transition-colors hover:border-steel hover:bg-white/5 hover:text-snow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
							aria-label="Menu dokumen proyek"
							title="Dokumen Proyek"
						>
							<Menu size={16} />
						</button>
					)}
					<Logo height={28} />
				</div>

				{/* Mobile: step dots (flow routes only) */}
				{isFlowStepRoute && (
					<div className="flex md:hidden flex-1 items-center justify-center">
						<FlowStepNav
							step={projectNavData?.step}
							taskStatus={projectNavData?.taskStatus}
						/>
					</div>
				)}

				{/* Center: navlinks - Desktop */}
				<div className="hidden md:flex flex-1 items-center justify-center">
					{isFlowStepRoute ? (
						<FlowStepNav
							step={projectNavData?.step}
							taskStatus={projectNavData?.taskStatus}
						/>
					) : (
						<div className="flex items-center gap-1">
							<Link
								to="/"
								className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
									pathname === "/"
										? "bg-white/10 text-snow"
										: "text-fog hover:bg-white/5 hover:text-snow"
								}`}
							>
								Home
							</Link>
							<Link
								to="/pricing"
								className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
									pathname.startsWith("/pricing")
										? "bg-white/10 text-snow"
										: "text-fog hover:bg-white/5 hover:text-snow"
								}`}
							>
								Pricing
							</Link>
							<Link
								to="/faq"
								className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
									pathname === "/faq"
										? "bg-white/10 text-snow"
										: "text-fog hover:bg-white/5 hover:text-snow"
								}`}
							>
								FAQ
							</Link>
							<Link
								to="/history"
								className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
									pathname === "/history"
										? "bg-white/10 text-snow"
										: "text-fog hover:bg-white/5 hover:text-snow"
								}`}
							>
								History
							</Link>
						</div>
					)}
				</div>

				{/* Right: actions */}
				<div className="flex md:w-[220px] shrink-0 items-center justify-end gap-2 ml-auto md:ml-0">
					{/* Mobile hamburger */}
					{!isFlowStepRoute && (
						<button
							type="button"
							className="md:hidden p-2 text-fog hover:text-snow transition-colors shrink-0"
							onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
							aria-label="Toggle menu"
						>
							{isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
						</button>
					)}
					{/* Workspace action buttons - visible all screens */}
					{isFlowStepRoute ? (
						<>
							{routeStep === "question" &&
								projectId &&
								flowCta?.kind === "navigate" && (
									<button
										type="button"
										onClick={() => {
											startTransition(() => {
												const targetPath =
													flowCta.targetStep === "task"
														? "/task/$id"
														: flowCta.targetStep === "ac"
															? "/ac/$id"
															: "/prd/$id";
												navigate({
													to: targetPath,
													params: { id: projectId },
												});
											});
										}}
										className="btn-primary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-[510] transition-all hover:brightness-105 active:scale-[0.98]"
									>
										<span className="whitespace-nowrap">{flowCta.label}</span>
										<ArrowRight size={12} />
									</button>
								)}
							{routeStep === "prd" && projectId && (
								<>
									<button
										type="button"
										onClick={() => useUIStore.getState().toggleChatPanel()}
										className="hidden md:flex items-center gap-1.5 rounded-md bg-charcoal px-3 py-1.5 text-xs font-[510] text-fog shadow-[var(--shadow-inset)] transition-colors hover:bg-white/5 hover:text-snow"
										aria-label="Buka/tutup chat"
									>
										<MessageSquare size={14} />
										<span>Chat</span>
									</button>
									{isFree ? (
										<Link
											to="/pricing"
											className="btn-primary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-[510] transition-all hover:brightness-105 active:scale-[0.98]"
										>
											<span className="whitespace-nowrap">Upgrade ke Pro</span>
											<ArrowRight size={12} />
										</Link>
									) : flowCta?.kind === "navigate" ? (
										<button
											type="button"
											onClick={() => {
												startTransition(() => {
													navigate({
														to:
															flowCta.targetStep === "task"
																? "/task/$id"
																: "/ac/$id",
														params: { id: projectId },
													});
												});
											}}
											className="btn-primary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-[510] transition-all hover:brightness-105 active:scale-[0.98]"
										>
											<span className="whitespace-nowrap">{flowCta.label}</span>
											<ArrowRight size={12} />
										</button>
									) : (
										<button
											type="button"
											onClick={handleStepAc}
											disabled={
												isStepLoading ||
												isGeneratingPRD ||
												hasStreamingPRDContent
											}
											className="btn-primary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-[510] transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-40 disabled:bg-graphite/40 disabled:text-fog/50"
										>
											{isStepLoading ? (
												"Memuat..."
											) : (
												<>
													<span>Generate AC</span>
													<ArrowRight size={12} />
												</>
											)}
										</button>
									)}
								</>
							)}
							{routeStep === "ac" &&
								projectId &&
								(isFree ? (
									<Link
										to="/pricing"
										className="btn-primary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-[510] transition-all hover:brightness-105 active:scale-[0.98]"
									>
										<span className="whitespace-nowrap">Upgrade ke Pro</span>
										<ArrowRight size={12} />
									</Link>
								) : flowCta?.kind === "navigate" ? (
									<button
										type="button"
										onClick={() => {
											startTransition(() => {
												navigate({
													to: "/task/$id",
													params: { id: projectId },
												});
											});
										}}
										className="btn-primary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-[510] transition-all hover:brightness-105 active:scale-[0.98]"
									>
										<span className="whitespace-nowrap">{flowCta.label}</span>
										<ArrowRight size={12} />
									</button>
								) : (
									<button
										type="button"
										onClick={handleStepTask}
										disabled={
											isStepLoading ||
											isGeneratingAC ||
											isGeneratingPRD ||
											hasStreamingPRDContent
										}
										className="btn-primary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-[510] transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-40 disabled:bg-graphite/40 disabled:text-fog/50"
									>
										{isStepLoading ||
										isGeneratingAC ||
										isGeneratingPRD ||
										hasStreamingPRDContent ? (
											"Memuat..."
										) : (
											<>
												<span>Generate Task</span>
												<ArrowRight size={12} />
											</>
										)}
									</button>
								))}
						</>
					) : null}

					{/* Desktop-only items */}
					<div className="hidden md:flex items-center gap-2">
						{!isFlowStepRoute && (
							<>
								<ThemeToggle />
								{isLoading ? (
									<div className="ml-1 flex items-center gap-2 sm:gap-3">
										<div className="h-8 w-[72px] animate-pulse rounded-md bg-white/5" />
										<div className="h-8 w-[84px] animate-pulse rounded-md bg-white/5" />
									</div>
								) : !user ? (
									<Link
										to="/login"
										className="btn-primary flex h-8 items-center justify-center rounded-md px-4 font-inter text-sm font-[510] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:brightness-105 active:scale-[0.98]"
									>
										Log In
									</Link>
								) : (
									<div className="relative">
										<button
											type="button"
											onClick={() => setIsDropdownOpen(!isDropdownOpen)}
											aria-label="User menu"
											aria-haspopup="true"
											aria-expanded={isDropdownOpen}
											className="flex h-8 w-8 items-center justify-center rounded-full bg-obsidian text-fog shadow-[var(--shadow-inset)] transition-colors duration-300 hover:text-snow"
										>
											<User size={16} />
										</button>
										{isDropdownOpen && (
											<>
												<button
													type="button"
													aria-label="Tutup menu pengguna"
													className="fixed inset-0 z-40 cursor-default bg-transparent border-0"
													onClick={() => setIsDropdownOpen(false)}
												/>
												<div className="absolute right-0 top-full z-50 mt-2 flex w-56 flex-col overflow-hidden rounded-xl bg-obsidian py-2 font-inter shadow-[var(--shadow-overlay)]">
													<div className="px-4 py-2 mb-1">
														<p className="truncate text-sm font-[510] text-snow">
															{user?.email}
														</p>
													</div>
													<div className="mb-1 h-px w-full bg-graphite" />
													<Link
														to="/settings/profile"
														onClick={() => setIsDropdownOpen(false)}
														className="flex items-center gap-3 px-4 py-2.5 text-sm font-[510] text-mist transition-colors hover:bg-white/5 hover:text-snow"
													>
														<Settings size={16} className="text-fog" />
														Setting
													</Link>
													{session?.user &&
														Boolean(
															(
																session.user as {
																	isAdmin?: boolean;
																	is_admin?: boolean;
																}
															).isAdmin ||
																(
																	session.user as {
																		isAdmin?: boolean;
																		is_admin?: boolean;
																	}
																).is_admin,
														) && (
															<Link
																to="/admin"
																onClick={() => setIsDropdownOpen(false)}
																className="flex items-center gap-3 px-4 py-2.5 text-sm font-[510] text-mist transition-colors hover:bg-white/5 hover:text-snow"
															>
																<Shield size={16} className="text-fog" />
																Admin
															</Link>
														)}
													<Link
														to="/settings/feedback"
														onClick={() => setIsDropdownOpen(false)}
														className="flex items-center gap-3 px-4 py-2.5 text-sm font-[510] text-mist transition-colors hover:bg-white/5 hover:text-snow"
													>
														<MessageSquare size={16} className="text-fog" />
														Bantuan & Feedback
													</Link>
													<div className="my-1 h-px w-full bg-graphite" />
													<button
														type="button"
														onClick={() => {
															setIsDropdownOpen(false);
															handleLogout();
														}}
														className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-[510] text-crimson transition-colors hover:bg-crimson/10"
													>
														<LogOut size={16} />
														Log Out
													</button>
												</div>
											</>
										)}
									</div>
								)}
							</>
						)}
					</div>
				</div>
			</div>

			{/* Mobile Menu Drawer */}
			{isMobileMenuOpen && (
				<div className="md:hidden border-t border-graphite bg-obsidian px-6 py-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
					<div className="flex items-center justify-between">
						<span className="text-sm font-[510] text-fog">Tampilan</span>
						<ThemeToggle />
					</div>
					<Link
						to="/"
						className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-[510] text-snow hover:bg-white/5"
						onClick={() => setIsMobileMenuOpen(false)}
					>
						Home
					</Link>
					<Link
						to="/pricing"
						className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-[510] text-snow hover:bg-white/5"
						onClick={() => setIsMobileMenuOpen(false)}
					>
						Pricing
					</Link>
					<Link
						to="/history"
						className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-[510] text-snow hover:bg-white/5"
						onClick={() => setIsMobileMenuOpen(false)}
					>
						History
					</Link>
					<Link
						to="/faq"
						className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-[510] text-snow hover:bg-white/5"
						onClick={() => setIsMobileMenuOpen(false)}
					>
						FAQ
					</Link>
					<Link
						to="/settings"
						className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-[510] text-snow hover:bg-white/5"
						onClick={() => setIsMobileMenuOpen(false)}
					>
						Settings
					</Link>
				</div>
			)}
		</nav>
	);
}
