import { describe, expect, it } from "vitest";
import { deriveProjectNameSync, hasExplicitProductName } from "./prd-service";

describe("deriveProjectNameSync", () => {
	it("prefers a quoted product name", () => {
		expect(
			deriveProjectNameSync('Buatkan aplikasi kasir bernama "Warung Pintar"'),
		).toBe("Warung Pintar");
	});

	it("extracts bernama-X pattern without quotes", () => {
		expect(
			deriveProjectNameSync("tolong buatkan habit tracker bernama HabitFlow"),
		).toBe("HabitFlow");
	});

	it("extracts a CamelCase brand token", () => {
		expect(
			deriveProjectNameSync(
				"Buatkan SaaS habit tracker bernama HabitFlow — web app pakai React (Vite)",
			),
		).toBe("HabitFlow");
	});

	it("falls back to last meaningful words when no pattern", () => {
		expect(
			deriveProjectNameSync(
				"platform manajemen proyek untuk tim remote dengan time tracking",
			),
		).toBe("Tim Remote Time Tracking");
	});

	it("ignores compiled preference blocks and names from the idea line", () => {
		const compiled = [
			"Tolong buatkan PRD dengan spesifikasi berikut:",
			"",
			"[Platform: Web App]",
			"Platform edukasi kursus coding online interaktif untuk pemula",
			"",
			"--- Preferensi Non-Teknis ---",
			"- Siapa target pengguna utama?: Pemula",
			"",
			"--- Preferensi Teknis ---",
			"Frontend: React (Vite)",
			"Backend: Biarkan AI yang memilih",
			"Fullstack Framework: Tidak dipakai",
			"Database: PostgreSQL",
			"Deployment: Biarkan AI yang memilih",
		].join("\n");
		expect(deriveProjectNameSync(compiled)).not.toMatch(/Deployment/i);
		expect(deriveProjectNameSync(compiled)).toContain("Coding");
	});

	it("ignores English compiled preference blocks too", () => {
		const compiled = [
			"Please generate a PRD with the following specifications:",
			"",
			"[Platform: Web App]",
			"Realtime collaborative whiteboard for remote teams",
			"",
			"--- Technical Preferences ---",
			"Frontend: React (Vite)",
			"Deployment: Let AI decide",
		].join("\n");
		expect(deriveProjectNameSync(compiled)).not.toMatch(/Deployment/i);
	});

	it("returns default for degenerate input", () => {
		expect(deriveProjectNameSync("buat app")).toBe("Project Baru");
	});
});

describe("hasExplicitProductName", () => {
	it("detects a quoted name inside a compiled-prompt-like string", () => {
		const compiledPrompt = [
			"Generate PRD lengkap berdasarkan informasi berikut:",
			'Ide produk: aplikasi dompet digital bernama "Dompet Kuotaku".',
			"Target pengguna: mahasiswa.",
			"[Platform: Web] Deployment: Biarkan AI memilih.",
			"Gunakan section markers sesuai standar.",
		].join("\n");
		expect(hasExplicitProductName(compiledPrompt)).toBe(true);
	});

	it("detects bernama-X pattern", () => {
		expect(
			hasExplicitProductName(
				"Buatkan habit tracker bernama HabitFlow untuk mahasiswa",
			),
		).toBe(true);
	});

	it("detects a CamelCase brand token", () => {
		expect(hasExplicitProductName("Buatkan SaaS untuk NovaPay")).toBe(true);
	});

	it("rejects a vague prompt without any explicit pattern", () => {
		expect(
			hasExplicitProductName(
				"platform manajemen proyek untuk tim remote dengan time tracking",
			),
		).toBe(false);
	});

	it("rejects empty and degenerate input", () => {
		expect(hasExplicitProductName("")).toBe(false);
		expect(hasExplicitProductName("buat app")).toBe(false);
	});
});
