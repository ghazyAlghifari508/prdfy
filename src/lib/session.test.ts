import { describe, expect, it } from "vitest";
import { isAdmin, isBanned } from "@/lib/session";

function requireUserGuard(session: { user: Record<string, unknown> } | null) {
	if (!session?.user) throw new Error("Unauthorized");
	if (isBanned(session.user)) throw new Error("Forbidden");
	return session.user;
}

function requireAdminGuard(session: { user: Record<string, unknown> } | null) {
	if (!session?.user) throw new Error("Unauthorized");
	if (isBanned(session.user)) throw new Error("Forbidden");
	if (!isAdmin(session.user)) throw new Error("Forbidden");
	return session.user;
}

describe("isBanned helper", () => {
	it("returns false for null/undefined user", () => {
		expect(isBanned(null)).toBe(false);
		expect(isBanned(undefined)).toBe(false);
	});

	it("returns false when banned is missing, null, or undefined", () => {
		expect(isBanned({ id: "u1" })).toBe(false);
		expect(isBanned({ id: "u1", bannedAt: null })).toBe(false);
		expect(isBanned({ id: "u1", banned_at: null })).toBe(false);
	});

	it("returns true when bannedAt or banned_at is truthy", () => {
		expect(isBanned({ id: "u1", bannedAt: new Date() })).toBe(true);
		expect(isBanned({ id: "u1", banned_at: new Date() })).toBe(true);
		expect(isBanned({ id: "u1", bannedAt: "2026-08-26T00:00:00.000Z" })).toBe(
			true,
		);
	});
});

describe("isAdmin helper", () => {
	it("returns false when isAdmin/is_admin is missing, falsy, or false", () => {
		expect(isAdmin(null)).toBe(false);
		expect(isAdmin({ id: "u1" })).toBe(false);
		expect(isAdmin({ id: "u1", isAdmin: false })).toBe(false);
		expect(isAdmin({ id: "u1", is_admin: false })).toBe(false);
	});

	it("returns true when isAdmin or is_admin is true", () => {
		expect(isAdmin({ id: "u1", isAdmin: true })).toBe(true);
		expect(isAdmin({ id: "u1", is_admin: true })).toBe(true);
	});

	it("returns true when user email matches ADMIN_EMAILS environment variable", () => {
		const original = process.env.ADMIN_EMAILS;
		process.env.ADMIN_EMAILS = "alghifarighazy508@gmail.com, admin@prdfy.com";
		try {
			expect(isAdmin({ id: "u1", email: "alghifarighazy508@gmail.com" })).toBe(
				true,
			);
			expect(isAdmin({ id: "u1", email: "AlGhifariGhazy508@gmail.com" })).toBe(
				true,
			);
			expect(isAdmin({ id: "u1", email: "ADMIN@PRDFY.COM" })).toBe(true);
			expect(isAdmin({ id: "u1", email: "other@example.com" })).toBe(false);
		} finally {
			process.env.ADMIN_EMAILS = original;
		}
	});
});

describe("requireUser guard", () => {
	it("throws Unauthorized when session is null", () => {
		expect(() => requireUserGuard(null)).toThrow("Unauthorized");
	});

	it("throws Forbidden when user is banned", () => {
		expect(() =>
			requireUserGuard({ user: { id: "u1", bannedAt: new Date() } }),
		).toThrow("Forbidden");
		expect(() =>
			requireUserGuard({ user: { id: "u1", banned_at: new Date() } }),
		).toThrow("Forbidden");
	});

	it("returns user when valid and not banned", () => {
		const user = { id: "u1", email: "test@example.com" };
		expect(requireUserGuard({ user })).toEqual(user);
	});
});

describe("requireAdmin guard", () => {
	it("throws Unauthorized when session is null", () => {
		expect(() => requireAdminGuard(null)).toThrow("Unauthorized");
	});

	it("throws Forbidden when user is not admin", () => {
		expect(() => requireAdminGuard({ user: { id: "u1" } })).toThrow(
			"Forbidden",
		);
		expect(() =>
			requireAdminGuard({ user: { id: "u1", isAdmin: false } }),
		).toThrow("Forbidden");
	});

	it("throws Forbidden when admin is banned", () => {
		expect(() =>
			requireAdminGuard({
				user: { id: "u1", isAdmin: true, bannedAt: new Date() },
			}),
		).toThrow("Forbidden");
	});

	it("returns user when user is admin", () => {
		const adminUser = { id: "u1", email: "admin@example.com", isAdmin: true };
		expect(requireAdminGuard({ user: adminUser })).toEqual(adminUser);
	});

	it("allows user whose email is in ADMIN_EMAILS even if isAdmin is missing or false", () => {
		const original = process.env.ADMIN_EMAILS;
		process.env.ADMIN_EMAILS = "alghifarighazy508@gmail.com";
		try {
			const admin = {
				id: "u1",
				email: "alghifarighazy508@gmail.com",
				isAdmin: false,
			};
			expect(requireAdminGuard({ user: admin })).toEqual(admin);
		} finally {
			process.env.ADMIN_EMAILS = original;
		}
	});
});

describe("admin route authorization matrix", () => {
	function simulateAdminRouteGuard(
		session: { user: Record<string, unknown> } | null,
	) {
		try {
			requireAdminGuard(session);
			return { status: 200, action: "allow" };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg === "Unauthorized") {
				return { status: 302, action: "redirect", to: "/login" };
			}
			if (msg === "Forbidden") {
				return { status: 403, action: "forbidden" };
			}
			throw err;
		}
	}

	it("redirects unauthenticated user (none) to /login", () => {
		const res = simulateAdminRouteGuard(null);
		expect(res).toEqual({ status: 302, action: "redirect", to: "/login" });
	});

	it("returns 403 for authenticated normal user (non-admin) without redirecting to /login", () => {
		const normalUser = {
			id: "u-normal",
			email: "normal@example.com",
			isAdmin: false,
		};
		const res = simulateAdminRouteGuard({ user: normalUser });
		expect(res).toEqual({ status: 403, action: "forbidden" });
	});

	it("allows authenticated admin user (isAdmin: true)", () => {
		const adminUser = {
			id: "u-admin",
			email: "admin@example.com",
			isAdmin: true,
		};
		const res = simulateAdminRouteGuard({ user: adminUser });
		expect(res).toEqual({ status: 200, action: "allow" });
	});

	it("allows authenticated admin user via ADMIN_EMAILS (alghifarighazy508@gmail.com)", () => {
		const original = process.env.ADMIN_EMAILS;
		process.env.ADMIN_EMAILS = "alghifarighazy508@gmail.com";
		try {
			const ownerUser = {
				id: "u-owner",
				email: "alghifarighazy508@gmail.com",
			};
			const res = simulateAdminRouteGuard({ user: ownerUser });
			expect(res).toEqual({ status: 200, action: "allow" });
		} finally {
			process.env.ADMIN_EMAILS = original;
		}
	});
});
