"use client";

import { Link, useLocation } from "@tanstack/react-router";
import {
	CreditCard,
	Eye,
	EyeOff,
	FolderGit2,
	LayoutDashboard,
	MessageSquare,
	Settings,
	Users,
} from "lucide-react";
import type React from "react";
import { memo } from "react";
import {
	StreamerModeProvider,
	useStreamerMode,
} from "@/components/admin/streamer-mode-context";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

interface NavItem {
	href: string;
	label: string;
	icon: React.ComponentType<{ size?: number; className?: string }>;
	isActive: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
	{
		href: "/admin",
		label: "Ringkasan",
		icon: LayoutDashboard,
		isActive: (p: string) => p === "/admin" || p === "/admin/",
	},
	{
		href: "/admin/users",
		label: "Pengguna",
		icon: Users,
		isActive: (p: string) =>
			p === "/admin/users" || p.startsWith("/admin/users/"),
	},
	{
		href: "/admin/feedback",
		label: "Tiket",
		icon: MessageSquare,
		isActive: (p: string) =>
			p === "/admin/feedback" || p.startsWith("/admin/feedback/"),
	},
	{
		href: "/admin/projects",
		label: "Proyek",
		icon: FolderGit2,
		isActive: (p: string) =>
			p === "/admin/projects" || p.startsWith("/admin/projects/"),
	},
	{
		href: "/admin/transactions",
		label: "Transaksi",
		icon: CreditCard,
		isActive: (p: string) =>
			p === "/admin/transactions" || p.startsWith("/admin/transactions/"),
	},
	{
		href: "/settings/profile",
		label: "Pengaturan",
		icon: Settings,
		isActive: (p: string) =>
			p.startsWith("/admin/settings") || p.startsWith("/settings"),
	},
];

function AdminShellInner({ children }: { children: React.ReactNode }) {
	const pathname = useLocation({ select: (l) => l.pathname });
	const { isStreamerMode, toggleStreamerMode } = useStreamerMode();

	return (
		<div className="flex min-h-screen flex-col bg-onyx font-inter text-snow">
			{/* Sticky Top-Nav Header */}
			<header className="sticky top-0 z-40 w-full border-b border-graphite bg-charcoal/95 backdrop-blur">
				<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
					{/* Header Row 1: Brand + Workspace Link + Streamer Mode Toggle */}
					<div className="flex h-14 items-center justify-between gap-4 border-b border-graphite/60">
						{/* Left: Brand */}
						<div className="flex items-center gap-2.5">
							<Logo height={22} />
							<span className="text-sm font-[510] text-snow">Admin Panel</span>
						</div>

						{/* Right: Theme Toggle + Streamer Mode Toggle Button */}
						<div className="flex items-center gap-2">
							<ThemeToggle />

							<button
								type="button"
								onClick={toggleStreamerMode}
								className={cn(
									"flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-[510] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fog/40",
									isStreamerMode
										? "border-fog/50 bg-white/10 text-snow"
										: "border-graphite bg-transparent text-fog hover:border-fog/40 hover:text-snow",
								)}
								title={
									isStreamerMode
										? "Streamer Mode aktif (Data sensitif disamarkan)"
										: "Aktifkan Streamer Mode untuk menyamarkan nominal dan data pengguna"
								}
							>
								{isStreamerMode ? <EyeOff size={14} /> : <Eye size={14} />}
								<span className="hidden xs:inline sm:inline">
									Streamer Mode
								</span>
								<span
									className={cn(
										"rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
										isStreamerMode
											? "bg-white/20 text-snow"
											: "bg-white/5 text-fog",
									)}
								>
									{isStreamerMode ? "ON" : "OFF"}
								</span>
							</button>
						</div>
					</div>

					{/* Header Row 2: Horizontal Navigation Tabs */}
					<nav className="flex items-center gap-1.5 overflow-x-auto py-2.5 hide-scrollbar">
						{NAV_ITEMS.map((item) => {
							const Icon = item.icon;
							const isActive = item.isActive(pathname);

							return (
								<Link
									key={item.label}
									to={item.href}
									preload="intent"
									aria-current={isActive ? "page" : undefined}
									className={cn(
										"flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-[510] transition-colors",
										isActive
											? "border border-graphite/80 bg-obsidian text-snow shadow-[var(--shadow-inset)]"
											: "text-fog hover:bg-white/5 hover:text-snow",
									)}
								>
									<Icon
										size={14}
										className={isActive ? "text-snow" : "text-fog"}
									/>
									<span>{item.label}</span>
								</Link>
							);
						})}
					</nav>
				</div>
			</header>

			{/* Main Content Area */}
			<main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
				{children}
			</main>
		</div>
	);
}

export const AdminClient = memo(function AdminClient({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<StreamerModeProvider>
			<AdminShellInner>{children}</AdminShellInner>
		</StreamerModeProvider>
	);
});
