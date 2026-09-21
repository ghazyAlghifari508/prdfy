"use client";

import { Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

interface ForbiddenPageProps {
	title?: string;
	description?: string;
	backTo?: string;
	backLabel?: string;
}

export function ForbiddenPage({
	title = "Akses Ditolak",
	description = "Akun ini tidak memiliki izin untuk mengakses halaman admin.",
	backTo = "/",
	backLabel = "Kembali ke Workspace",
}: ForbiddenPageProps) {
	return (
		<main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center p-6 text-center font-inter select-none">
			<div className="w-full max-w-md rounded-2xl border border-graphite bg-charcoal p-8 shadow-[var(--shadow-inset)] flex flex-col items-center">
				<div className="mb-6 flex items-center justify-center">
					<Logo />
				</div>

				<div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-graphite bg-obsidian text-fog">
					<ShieldAlert size={28} className="text-crimson/90" />
				</div>

				<span className="mb-2 font-mono text-xs font-semibold tracking-wider text-fog uppercase">
					403 Forbidden
				</span>

				<h1 className="mb-3 text-2xl font-bold text-snow tracking-tight">
					{title}
				</h1>

				<p className="mb-8 text-sm text-fog leading-relaxed max-w-xs">
					{description}
				</p>

				<div className="flex w-full flex-col gap-3">
					<Link
						to={backTo}
						className={cn(
							buttonVariants({ variant: "default" }),
							"w-full inline-flex items-center justify-center gap-2",
						)}
					>
						<ArrowLeft size={16} />
						<span>{backLabel}</span>
					</Link>
				</div>
			</div>
		</main>
	);
}
