import { afterEach, describe, expect, it } from "vitest";
import { getMidtransConfig } from "@/lib/midtrans";

const SANDBOX_KEY = "Midtrans-Server-Key-Sandbox";
const PROD_KEY = "Midtrans-Server-Key-Production";

afterEach(() => {
	delete process.env.MIDTRANS_ENVIRONMENT;
	delete process.env.MIDTRANS_SERVER_KEY;
	delete process.env.MIDTRANS_SERVER_KEY_SANDBOX;
});

describe("getMidtransConfig", () => {
	it("defaults to sandbox with the sandbox server key", () => {
		process.env.MIDTRANS_SERVER_KEY_SANDBOX = SANDBOX_KEY;
		const config = getMidtransConfig();
		expect(config.environment).toBe("sandbox");
		expect(config.serverKey).toBe(SANDBOX_KEY);
		expect(config.snapBaseUrl).toContain("sandbox");
		expect(config.apiBaseUrl).toContain("sandbox");
	});

	it("selects production endpoints only with explicit environment and key", () => {
		process.env.MIDTRANS_ENVIRONMENT = "production";
		process.env.MIDTRANS_SERVER_KEY = PROD_KEY;
		const config = getMidtransConfig();
		expect(config.environment).toBe("production");
		expect(config.serverKey).toBe(PROD_KEY);
		expect(config.snapBaseUrl).not.toContain("sandbox");
		expect(config.apiBaseUrl).not.toContain("sandbox");
	});

	it("fails closed on unknown environment or missing key", () => {
		process.env.MIDTRANS_ENVIRONMENT = "staging";
		process.env.MIDTRANS_SERVER_KEY_SANDBOX = SANDBOX_KEY;
		expect(() => getMidtransConfig()).toThrow();

		delete process.env.MIDTRANS_ENVIRONMENT;
		delete process.env.MIDTRANS_SERVER_KEY_SANDBOX;
		expect(() => getMidtransConfig()).toThrow();
	});
});
