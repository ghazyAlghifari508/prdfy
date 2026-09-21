import { createHash, randomBytes } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { requireUser } from "@/lib/session";

const ALLOWED_SCOPES = [
	"read:project",
	"write:task:status",
	"write:subtask:status",
];

export const Route = createFileRoute("/api/settings/api-keys/")({
	server: {
		handlers: {
			GET: async () => {
				const user = await requireUser(getRequestHeaders());
				const rows = await db
					.select({
						id: apiKeys.id,
						name: apiKeys.name,
						keyPrefix: apiKeys.keyPrefix,
						scopes: apiKeys.scopes,
						lastUsedAt: apiKeys.lastUsedAt,
						createdAt: apiKeys.createdAt,
						expiresAt: apiKeys.expiresAt,
					})
					.from(apiKeys)
					.where(eq(apiKeys.userId, user.id))
					.orderBy(asc(apiKeys.createdAt));
				return Response.json({ keys: rows });
			},
			POST: async ({ request }: { request: Request }) => {
				const user = await requireUser(getRequestHeaders());
				const body = await request.json();
				const { name, scopes } = body;

				if (
					!name ||
					typeof name !== "string" ||
					name.length < 1 ||
					name.length > 100
				)
					return Response.json(
						{ error: "Nama key harus 1-100 karakter" },
						{ status: 400 },
					);
				if (!Array.isArray(scopes) || scopes.length === 0)
					return Response.json(
						{ error: "Minimal satu scope harus dipilih" },
						{ status: 400 },
					);
				if (scopes.some((s: string) => !ALLOWED_SCOPES.includes(s)))
					return Response.json({ error: "Scope tidak valid" }, { status: 400 });

				const rawKey = `prdfy_${randomBytes(32).toString("hex")}`;
				const keyHash = createHash("sha256").update(rawKey).digest("hex");
				const keyPrefix = rawKey.slice(0, 10);

				const [inserted] = await db
					.insert(apiKeys)
					.values({
						id: crypto.randomUUID(),
						userId: user.id,
						name,
						key: keyHash,
						keyPrefix,
						scopes,
					})
					.returning({ id: apiKeys.id });
				if (!inserted)
					return Response.json(
						{ error: "Gagal membuat API key" },
						{ status: 500 },
					);
				// One-time bearer credential: must never be cached by
				// browsers, proxies, or history.
				return Response.json(
					{ id: inserted.id, rawKey },
					{
						headers: {
							"Cache-Control": "no-store",
							Pragma: "no-cache",
						},
					},
				);
			},
		},
	},
});
