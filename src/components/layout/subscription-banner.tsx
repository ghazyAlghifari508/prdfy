import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useUserPlan } from "@/hooks/use-user-plan";

/**
 * Global pause notice (spec §8). Rendered inside AppLayout's content
 * wrapper, in flow below the fixed Navbar; driven entirely by server truth
 * (/api/user/plan) — no client-side guessing from credit counts.
 */
export function SubscriptionBanner() {
	const { data } = useUserPlan();
	if (!data?.authenticated || data.subscriptionState !== "paused") return null;

	return (
		// biome-ignore lint/a11y/useSemanticElements: role="status" is mandated by spec for the pause notice
		<div
			role="status"
			// shrink-0: the notice keeps its full height inside the fixed-height
			// workspace shell, so the scrollable route below shrinks instead of
			// pushing content (and the Next button) out of reach.
			className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500/15 px-4 py-2 text-center text-sm text-amber-700 dark:text-amber-400"
		>
			<AlertTriangle size={16} className="shrink-0" aria-hidden />
			<span>
				Masa aktif langganan <b className="capitalize">{data.plan}</b> sudah
				habis — sisa kredit hangus dan generate terkunci.
			</span>
			<Link
				to="/settings/billing"
				className="font-semibold underline underline-offset-2 hover:opacity-80"
			>
				Perpanjang atau batalkan
			</Link>
		</div>
	);
}
