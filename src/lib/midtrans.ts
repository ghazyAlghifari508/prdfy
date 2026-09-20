/**
 * Server-only Midtrans gateway configuration.
 *
 * Sandbox is the default until MIDTRANS_ENVIRONMENT=production with a
 * production server key is configured explicitly. Missing credentials
 * fail closed so neither checkout, sync, nor webhooks can run half
 * configured. Never import this module (or its values) from client code.
 */

export type MidtransEnvironment = "sandbox" | "production";

export interface MidtransConfig {
	environment: MidtransEnvironment;
	serverKey: string;
	snapBaseUrl: string;
	apiBaseUrl: string;
}

const SANDBOX_SNAP_BASE_URL = "https://app.sandbox.midtrans.com/snap/v1";
const SANDBOX_API_BASE_URL = "https://api.sandbox.midtrans.com/v2";
const PRODUCTION_SNAP_BASE_URL = "https://app.midtrans.com/snap/v1";
const PRODUCTION_API_BASE_URL = "https://api.midtrans.com/v2";

export function getMidtransConfig(): MidtransConfig {
	const raw = (process.env.MIDTRANS_ENVIRONMENT ?? "sandbox").trim();
	if (raw !== "sandbox" && raw !== "production") {
		throw new Error("Invalid MIDTRANS_ENVIRONMENT env var");
	}
	const environment = raw as MidtransEnvironment;
	const serverKey =
		environment === "production"
			? process.env.MIDTRANS_SERVER_KEY
			: process.env.MIDTRANS_SERVER_KEY_SANDBOX;
	if (!serverKey) {
		throw new Error(
			environment === "production"
				? "Missing MIDTRANS_SERVER_KEY env var"
				: "Missing MIDTRANS_SERVER_KEY_SANDBOX env var",
		);
	}
	return {
		environment,
		serverKey,
		snapBaseUrl:
			environment === "production"
				? PRODUCTION_SNAP_BASE_URL
				: SANDBOX_SNAP_BASE_URL,
		apiBaseUrl:
			environment === "production" ? PRODUCTION_API_BASE_URL : SANDBOX_API_BASE_URL,
	};
}

export function midtransAuthHeader(serverKey: string): string {
	return `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`;
}
