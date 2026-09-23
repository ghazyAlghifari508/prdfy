import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { desc, eq, inArray } from "drizzle-orm";
import { useState } from "react";
import { codebaseSnapshots, codebases } from "@/db/schema";
import {
	getPendingSyncPayloadKey,
	syncPromptPayloadSchema,
} from "@/lib/codebase-sync";
import { requireUserServer } from "@/lib/session";

export function decideCodebaseListEntry(): "allow" {
	return "allow";
}

const loadCodebases = createServerFn({ method: "GET" }).handler(async () => {
	const user = await requireUserServer();
	const rows = await dbSelectCodebases(user.id);
	return { codebases: rows };
});

async function dbSelectCodebases(userId: string) {
	const { db } = await import("@/db");
	const rows = await db
		.select({
			id: codebases.id,
			name: codebases.name,
			createdAt: codebases.createdAt,
		})
		.from(codebases)
		.where(eq(codebases.userId, userId))
		.orderBy(desc(codebases.updatedAt));
	const ids = rows.map((row) => row.id);
	const snapshots = ids.length
		? await db
				.select({
					id: codebaseSnapshots.id,
					codebaseId: codebaseSnapshots.codebaseId,
					createdAt: codebaseSnapshots.createdAt,
					commitSha: codebaseSnapshots.commitSha,
					fileCount: codebaseSnapshots.fileCount,
				})
				.from(codebaseSnapshots)
				.where(inArray(codebaseSnapshots.codebaseId, ids))
				.orderBy(desc(codebaseSnapshots.createdAt))
		: [];
	const latest = new Map<string, (typeof snapshots)[number]>();
	for (const snapshot of snapshots) {
		if (snapshot.codebaseId && !latest.has(snapshot.codebaseId))
			latest.set(snapshot.codebaseId, snapshot);
	}
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		createdAt: row.createdAt?.toISOString() ?? null,
		latestSnapshot: latest.get(row.id)
			? {
					id: latest.get(row.id)?.id ?? "",
					createdAt: latest.get(row.id)?.createdAt?.toISOString() ?? null,
					commitSha: latest.get(row.id)?.commitSha ?? null,
					fileCount: latest.get(row.id)?.fileCount ?? 0,
				}
			: null,
	}));
}

export const Route = createFileRoute("/codebases")({
	loader: async () => {
		try {
			return await loadCodebases();
		} catch (error) {
			if (error instanceof Error && error.message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw error;
		}
	},
	head: () => ({ meta: [{ title: "Codebase | PrdFy" }] }),
	component: CodebasesPage,
	errorComponent: ({ reset }) => (
		<main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-12 sm:px-6">
			<div
				role="alert"
				className="rounded-xl border border-crimson/40 bg-crimson/10 p-5 text-crimson"
			>
				<h1 className="text-lg font-semibold">Codebase gagal dimuat</h1>
				<p className="mt-1 text-sm">
					Periksa koneksi lalu coba muat ulang daftar codebase.
				</p>
				<button
					type="button"
					onClick={reset}
					className="mt-4 min-h-11 rounded-md border border-crimson/50 px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
				>
					Coba lagi
				</button>
			</div>
		</main>
	),
});

function CodebasesPage() {
	const { codebases: items } = Route.useLoaderData();
	const navigate = useNavigate();
	const [isCreating, setIsCreating] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);

	const createCodebase = async () => {
		if (name.trim().length < 3) {
			setError("Nama codebase harus diisi minimal 3 karakter.");
			return;
		}
		setError(null);
		setIsSubmitting(true);
		try {
			const response = await fetch("/api/codebases", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: name.trim() }),
			});
			const body: unknown = await response.json().catch(() => null);
			if (
				!response.ok ||
				typeof body !== "object" ||
				body === null ||
				!("id" in body) ||
				typeof body.id !== "string"
			) {
				setError("Codebase gagal dibuat. Coba lagi.");
				return;
			}
			if ("sync" in body) {
				const sync = syncPromptPayloadSchema.safeParse(body.sync);
				if (sync.success)
					sessionStorage.setItem(
						getPendingSyncPayloadKey(body.id),
						JSON.stringify(sync.data),
					);
			}
			await navigate({ to: "/codebases/$id", params: { id: body.id } });
		} catch {
			setError("Server tidak dapat dihubungi.");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
			<header className="flex flex-col gap-4 border-b border-graphite pb-6 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="font-mono text-xs uppercase tracking-widest text-fog">
						Workspace / Source context
					</p>
					<h1 className="mt-2 text-3xl font-semibold tracking-tight text-snow sm:text-4xl">
						Codebase
					</h1>
					<p className="mt-2 max-w-2xl text-sm leading-6 text-fog">
						Simpan repository yang sudah disinkronkan untuk merencanakan fitur
						berikutnya dengan konteks yang sama.
					</p>
				</div>
				<button
					type="button"
					onClick={() => setIsCreating((current) => !current)}
					className="min-h-11 rounded-md bg-snow px-4 text-sm font-semibold text-onyx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
				>
					{isCreating ? "Batal" : "Codebase baru"}
				</button>
			</header>
			{isCreating && (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void createCodebase();
					}}
					className="rounded-xl border border-graphite bg-charcoal p-5 sm:p-6"
				>
					<label
						htmlFor="codebase-name"
						className="text-sm font-medium text-snow"
					>
						Nama repository
					</label>
					<div className="mt-3 flex flex-col gap-3 sm:flex-row">
						<input
							id="codebase-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Contoh: Aplikasi marketplace"
							className="min-h-11 min-w-0 flex-1 rounded-lg border border-graphite bg-obsidian px-3 text-sm text-snow outline-none placeholder:text-slate focus-visible:ring-2 focus-visible:ring-indigo"
						/>
						<button
							type="submit"
							disabled={isSubmitting || name.trim().length < 3}
							className="min-h-11 rounded-md bg-snow px-4 text-sm font-semibold text-onyx disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
						>
							Buat dan hubungkan
						</button>
					</div>
					{error && (
						<p role="alert" className="mt-3 text-sm text-crimson">
							{error}
						</p>
					)}
				</form>
			)}
			{items.length === 0 ? (
				<section className="rounded-xl border border-dashed border-graphite bg-charcoal p-8 sm:p-10">
					<h2 className="text-xl font-semibold text-snow">
						Belum ada codebase
					</h2>
					<p className="mt-2 max-w-xl text-sm leading-6 text-fog">
						Buat satu codebase untuk mendapatkan prompt sync yang bisa
						dijalankan dari root repository.
					</p>
				</section>
			) : (
				<div className="overflow-x-auto rounded-xl border border-graphite bg-charcoal">
					<table className="w-full min-w-[640px] text-left text-sm">
						<thead className="border-b border-graphite text-xs uppercase tracking-wide text-fog">
							<tr>
								<th className="px-5 py-4">Nama</th>
								<th className="px-5 py-4">Sync terakhir</th>
								<th className="px-5 py-4">Commit</th>
								<th className="px-5 py-4">File</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-graphite/70">
							{items.map((item) => (
								<tr key={item.id} className="hover:bg-white/5">
									<td className="px-5 py-4">
										<Link
											to="/codebases/$id"
											params={{ id: item.id }}
											className="font-medium text-snow underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
										>
											{item.name}
										</Link>
									</td>
									<td className="px-5 py-4 text-fog">
										{item.latestSnapshot?.createdAt
											? new Date(item.latestSnapshot.createdAt).toLocaleString(
													"id-ID",
												)
											: "Belum pernah sync"}
									</td>
									<td className="px-5 py-4 font-mono text-xs text-fog">
										{item.latestSnapshot?.commitSha ?? "-"}
									</td>
									<td className="px-5 py-4 font-mono text-xs text-fog">
										{item.latestSnapshot?.fileCount ?? "-"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</main>
	);
}
