"use client";

import { useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { Logo } from "@/components/ui/logo";
import { authClient } from "@/lib/auth-client";
import { getSafeRedirectPath } from "@/lib/redirect";

const GoogleIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		className="h-5 w-5"
		viewBox="0 0 48 48"
	>
		<title>Google</title>
		<path
			fill="#FFC107"
			d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s12-5.373 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-2.641-.21-5.236-.611-7.743z"
		/>
		<path
			fill="#FF3D00"
			d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
		/>
		<path
			fill="#4CAF50"
			d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
		/>
		<path
			fill="#1976D2"
			d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-2.641-.21-5.236-.611-7.743z"
		/>
	</svg>
);

const GitHubIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		className="h-5 w-5"
		viewBox="0 0 24 24"
		fill="currentColor"
	>
		<title>GitHub</title>
		<path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.94c-3.2.7-3.87-1.54-3.87-1.54-.53-1.33-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.76.12 3.05.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.42.36.78 1.07.78 2.16v3.2c0 .3.21.66.79.55A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
	</svg>
);

export function LoginForm() {
	const searchStr = useLocation({ select: (l) => l.searchStr });
	const searchParams = new URLSearchParams(searchStr);
	const redirectTo = getSafeRedirectPath(searchParams.get("redirect"));
	const [loading, setLoading] = useState<"google" | "github" | null>(null);
	const [error, setError] = useState<string | null>(null);

	const signInWith = async (provider: "google" | "github") => {
		setError(null);
		setLoading(provider);

		// If user visits via 127.0.0.1, switch to localhost to match Google OAuth authorized callback & cookies
		if (
			typeof window !== "undefined" &&
			window.location.hostname === "127.0.0.1"
		) {
			const target = new URL(window.location.href);
			target.hostname = "localhost";
			window.location.replace(target.href);
			return;
		}

		try {
			const result = await authClient.signIn.social({
				provider,
				callbackURL: redirectTo,
			});
			if (result && typeof result === "object" && "error" in result && result.error) {
				setError("Gagal login. Coba lagi.");
				setLoading(null);
			}
		} catch {
			setError("Gagal login. Coba lagi.");
			setLoading(null);
		}
	};

	return (
		<div className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-onyx px-6 font-inter">
			<div className="w-full max-w-sm">
				<div className="mb-8 flex flex-col items-center gap-6 text-center">
					<Logo height={36} />
					<div>
						<h1 className="font-inter text-3xl font-light text-snow">
							Masuk ke PrdFy
						</h1>
						<p className="mt-2 text-sm leading-relaxed text-fog">
							Akses akun Anda dengan Google atau GitHub.
						</p>
					</div>
				</div>

				{error && (
					<div className="mb-4 rounded-md bg-crimson/10 p-4 text-sm font-[510] text-crimson shadow-[inset_0_0_0_1px_rgba(235,87,87,0.35)]">
						{error}
					</div>
				)}

				<div className="flex flex-col gap-3">
					<button
						type="button"
						onClick={() => signInWith("google")}
						disabled={loading !== null}
						className="flex w-full items-center justify-center gap-3 rounded-md bg-steel py-3 font-[510] text-snow shadow-[inset_0_0_0_1px_rgba(0,0,0,0.2)] transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-70"
					>
						<GoogleIcon />
						{loading === "google"
							? "Menghubungkan..."
							: "Lanjutkan dengan Google"}
					</button>

					<button
						type="button"
						onClick={() => signInWith("github")}
						disabled={loading !== null}
						className="flex w-full items-center justify-center gap-3 rounded-md bg-steel py-3 font-[510] text-snow shadow-[inset_0_0_0_1px_rgba(0,0,0,0.2)] transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-70"
					>
						<GitHubIcon />
						{loading === "github"
							? "Menghubungkan..."
							: "Lanjutkan dengan GitHub"}
					</button>
				</div>
			</div>
		</div>
	);
}
