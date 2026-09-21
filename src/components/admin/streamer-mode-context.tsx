import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";

const STORAGE_KEY = "prdfy_admin_streamer_mode";

export function maskCurrency(val: number | string, isMasked: boolean): string {
	if (isMasked) return "••••••••";
	const num = typeof val === "string" ? Number.parseFloat(val) : val;
	if (!Number.isFinite(num)) return "—";
	return formatCurrency(num);
}

export function maskOrderId(id: string, isMasked: boolean): string {
	if (!isMasked || !id) return id;
	const parts = id.split("-");
	if (parts.length <= 1) {
		return id.length > 4 ? `${id.slice(0, 2)}•••${id.slice(-2)}` : "••••";
	}
	const lastPart = parts[parts.length - 1];
	const maskedLast =
		lastPart.length > 2 ? `•••${lastPart.slice(-2)}` : `•••${lastPart}`;
	return `${parts.slice(0, -1).join("-")}-${maskedLast}`;
}

export function maskName(
	name: string | null | undefined,
	isMasked: boolean,
): string {
	if (!name) return "Anonymous";
	if (!isMasked) return name;
	const trimmed = name.trim();
	if (trimmed.length <= 1) return `${trimmed} • • •`;
	return `${trimmed[0]} • • • ${trimmed[trimmed.length - 1]}`;
}

export function maskEmail(
	email: string | null | undefined,
	isMasked: boolean,
): string {
	if (!email) return "—";
	if (!isMasked) return email;
	const at = email.indexOf("@");
	if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) {
		return "••••";
	}
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	const dot = domain.lastIndexOf(".");
	const ext =
		dot > 0 && dot < domain.length - 1 ? domain.slice(dot + 1) : "com";
	const firstChar = local[0] ?? "u";
	return `${firstChar}••••@••••.${ext}`;
}

interface StreamerModeContextType {
	isStreamerMode: boolean;
	toggleStreamerMode: () => void;
	maskCurrency: (val: number | string) => string;
	maskOrderId: (id: string) => string;
	maskName: (name: string | null | undefined) => string;
	maskEmail: (email: string | null | undefined) => string;
}

const StreamerModeContext = createContext<StreamerModeContextType>({
	isStreamerMode: false,
	toggleStreamerMode: () => {},
	maskCurrency: (v) => maskCurrency(v, false),
	maskOrderId: (id) => maskOrderId(id, false),
	maskName: (n) => maskName(n, false),
	maskEmail: (e) => maskEmail(e, false),
});

export function StreamerModeProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [isStreamerMode, setIsStreamerMode] = useState<boolean>(() => {
		if (typeof window === "undefined") return false;
		try {
			const saved = window.localStorage.getItem(STORAGE_KEY);
			return saved === "true";
		} catch {
			return false;
		}
	});

	useEffect(() => {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved !== null) {
				setIsStreamerMode(saved === "true");
			}
		} catch {
			// Ignore localStorage access errors
		}
	}, []);

	const toggleStreamerMode = () => {
		setIsStreamerMode((prev) => {
			const next = !prev;
			try {
				localStorage.setItem(STORAGE_KEY, String(next));
			} catch {
				// Ignore
			}
			return next;
		});
	};

	return (
		<StreamerModeContext.Provider
			value={{
				isStreamerMode,
				toggleStreamerMode,
				maskCurrency: (v) => maskCurrency(v, isStreamerMode),
				maskOrderId: (id) => maskOrderId(id, isStreamerMode),
				maskName: (n) => maskName(n, isStreamerMode),
				maskEmail: (e) => maskEmail(e, isStreamerMode),
			}}
		>
			{children}
		</StreamerModeContext.Provider>
	);
}

export function useStreamerMode() {
	return useContext(StreamerModeContext);
}
