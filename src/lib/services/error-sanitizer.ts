/**
 * Error sanitization - pure, copied from old project (no InsForge deps).
 */
export function sanitizeErrorForClient(error: unknown, context?: "ac"): string {
	if (!(error instanceof Error))
		return "Terjadi kesalahan yang tidak diketahui.";

	// Normalize once: matching is case-insensitive throughout, and every
	// branch below matches narrowly scoped tokens (status codes, structured
	// markers) instead of generic substrings like "Edge" or "fetch".
	const msg = error.message;
	const lower = msg.toLocaleLowerCase("en");

	if (context === "ac") {
		if (msg.includes("Respons kosong"))
			return "AI mengembalikan respon kosong. Silakan generate ulang.";
		if (
			msg.includes("Failed to save AC version") ||
			msg.includes("Failed to insert AC version")
		) {
			return "Penyimpanan ke database terlalu lama (timeout). Silakan klik tombol 'Retry Simpan' untuk mencoba menyimpan ulang hasil.";
		}
	}

	if (
		msg.includes("melebihi batas waktu") ||
		msg.includes("tidak merespons dalam")
	)
		return msg;

	if (lower.includes("timed out") || lower.includes("aborted")) {
		return "Penyimpanan ke database terlalu lama (timeout). Silakan klik tombol 'Retry Simpan' untuk mencoba menyimpan ulang hasil.";
	}

	if (
		lower.includes("504") ||
		lower.includes("gateway timeout") ||
		lower.includes("timedout")
	) {
		return "Generate PRD terlalu lama (server timeout). PRD mungkin sudah tersimpan sebagian - refresh halaman. Tips: pakai model ringan seperti Ling 3.0 Flash untuk generate yang lebih cepat.";
	}

	if (
		lower.includes("9router") ||
		lower.includes("failed to fetch") ||
		lower.includes("fetch failed") ||
		lower.includes("networkerror")
	) {
		return "Maaf, layanan AI sedang tidak tersedia atau sibuk. Silakan coba lagi dalam beberapa saat.";
	}

	if (lower.includes("429") || lower.includes("too many requests"))
		return "Terlalu banyak permintaan. Silakan tunggu sebentar.";

	if (
		lower.includes("pgrst") ||
		lower.includes("postgresterror") ||
		lower.includes("insforge")
	) {
		return "Terjadi kesalahan pada server. Silakan coba lagi.";
	}

	if (msg.includes("Unauthorized") || msg.includes("401"))
		return "Sesi Anda telah berakhir. Silakan login kembali.";

	if (
		msg.includes("Semua model") ||
		msg.includes("Limit") ||
		msg.includes("Gagal")
	)
		return msg;

	return "Terjadi kesalahan yang tidak diketahui.";
}
