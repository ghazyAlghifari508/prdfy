/**
 * Output depth for generated documents (PRD/AC/Task).
 *
 * Adaptif: kedalaman output menyesuaikan kompleksitas deskripsi user.
 * Aplikasi simpel → output ringkas tapi lengkap.
 * Aplikasi kompleks → output mendalam dan detail.
 * Tidak ada angka hardcode — AI menentukan kedalaman berdasarkan input.
 */
export type DocKind = "prd" | "ac" | "task";

const PRD = `
## MODE KEDALAMAN: ADAPTIF
Sesuaikan kedalaman dan panjang setiap section dengan KOMPLEKSITAS deskripsi produk dari user:
- Produk simpel (1-2 fitur utama, scope kecil) → tulis padat dan ringkas, tidak perlu memaksakan banyak section panjang.
- Produk menengah (3-5 fitur, beberapa integrasi) → tulis dengan kedalaman moderat, lengkap tapi tidak berlebihan.
- Produk kompleks (6+ fitur, banyak integrasi, multi-role) → tulis mendalam dan detail.
SEMUA section 1-8 WAJIB tetap ada dengan nama yang sama, tapi isinya proporsional terhadap kompleksitas produk. JANGAN memaksakan konten untuk produk simpel menjadi sangat panjang. JANGAN mengurangi detail untuk produk kompleks.`;

const AC = `
## MODE KEDALAMAN: ADAPTIF
Sesuaikan kedalaman dan jumlah AC dengan KOMPLEKSITAS PRD:
- PRD simpel → AC ringkas, fokus happy path dan validasi dasar.
- PRD menengah → AC lengkap dengan edge case dan authorization.
- PRD kompleks → AC mendalam dengan scenario, formula, dan error handling detail.
Struktur dokumen tetap sama, tapi jumlah AC per fitur proporsional terhadap kompleksitas fitur tersebut. JANGAN memaksakan banyak AC untuk fitur yang simpel. JANGAN mengurangi AC untuk fitur yang kompleks.`;

const TASK = `
## MODE KEDALAMAN: ADAPTIF & DETAIL LENGKAP
Sesuaikan jumlah task, subtask, dan detail dengan KOMPLEKSITAS requirement di PRD + AC:
- Wajib menyertakan Fase 0 (Inisialisasi & Fondasi Infrastruktur) sebelum masuk ke fitur fungsional.
- Setiap fitur pada AC wajib dipecah ke dalam 5-layer teknis (Data/Storage, Domain/Service Logic, API Contract, Dedicated Screen Layout, UI States & Interaction).
- Fitur simpel → sedikit task per layer tapi tetap modular, detail secukupnya.
- Fitur kompleks (banyak state, aturan bisnis, integrasi, async lifecycle) → banyak task dan subtask, detail mendalam per sub-komponen.
Jumlah task mengikuti jumlah deliverable yang benar-benar dibutuhkan, bukan target angka. JANGAN memaksakan banyak task kosong untuk fitur simpel. JANGAN mengurangi task atau menggabungkan requirement berbeda hanya agar output lebih pendek. Setiap subtask WAJIB punya field "details" (array langkah granular, minimum 1 item).`;

const TABLES: Record<DocKind, string> = { prd: PRD, ac: AC, task: TASK };

const VALID_KINDS: ReadonlySet<string> = new Set(Object.keys(TABLES));

export function depthDirective(kind: DocKind): string {
	// DocKind only constrains TypeScript callers: JSON, user input, or an
	// unsafe cast can still arrive here, and an undefined lookup would
	// silently poison prompt construction downstream.
	if (!VALID_KINDS.has(kind as string)) {
		throw new Error(
			`Unknown document kind for depth directive: ${String(kind)}`,
		);
	}
	return TABLES[kind];
}
