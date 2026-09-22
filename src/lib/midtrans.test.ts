import { afterEach, describe, expect, it } from "vitest";
import {
	getMidtransConfig,
	midtransAuthHeader,
	midtransRequestHeaders,
} from "@/lib/midtrans";

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

describe("midtransAuthHeader", () => {
	// Regression: Midtrans rejects a doubled scheme ("Basic Basic <b64>") with
	// HTTP 400 {"error_messages":["bad request"]}. The helper owns the scheme,
	// so callers must send its value as-is; this test pins the single prefix.
	it("returns exactly one Basic scheme followed by the key's base64", () => {
		const header = midtransAuthHeader(SANDBOX_KEY);
		const expected = `Basic ${Buffer.from(`${SANDBOX_KEY}:`).toString("base64")}`;
		expect(header).toBe(expected);
		expect(header.match(/Basic/g)).toHaveLength(1);
		expect(header.startsWith("Basic Basic")).toBe(false);
	});

	it("base64-encodes the server key with a trailing colon and blank password", () => {
		const header = midtransAuthHeader("abc");
		const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString(
			"utf8",
		);
		expect(decoded).toBe("abc:");
	});
});

describe("midtransRequestHeaders", () => {
	it("builds the Snap authorization header without doubling the scheme", () => {
		const headers = midtransRequestHeaders(SANDBOX_KEY);
		expect(headers.Authorization).toBe(midtransAuthHeader(SANDBOX_KEY));
		expect(headers.Authorization.startsWith("Basic Basic")).toBe(false);
		expect(headers["Content-Type"]).toBe("application/json");
		expect(headers.Accept).toBe("application/json");
	});
});
