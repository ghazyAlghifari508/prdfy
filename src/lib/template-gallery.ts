// Readonly catalogs: shared definitions must not be mutable at runtime —
// any module could otherwise push/splice entries and corrupt every
// subsequent render in the process. Deep-frozen below.
interface CatalogEntry {
	readonly id: string;
	readonly title: string;
	readonly prompt: string;
}

interface TemplateEntry extends CatalogEntry {
	readonly icon: string;
	readonly platform: "web" | "mobile";
}

function freezeCatalog<T extends CatalogEntry>(entries: T[]): readonly T[] {
	for (const entry of entries) Object.freeze(entry);
	return Object.freeze(entries);
}

export const TEMPLATE_GALLERY: readonly TemplateEntry[] = freezeCatalog([
	{
		id: "saas-analytics",
		title: "SaaS Analytics Dashboard",
		icon: "BarChart",
		platform: "web" as const,
		prompt:
			"Saya ingin membuat SaaS Analytics Dashboard untuk UMKM yang menampilkan penjualan harian, stok, dan prediksi AI. Target user pemilik toko. Butuh role admin dan staff, integrasi Midtrans, dan laporan export PDF. Buatkan PRD lengkap.",
	},
	{
		id: "marketplace",
		title: "Marketplace UMKM",
		icon: "Store",
		platform: "web" as const,
		prompt:
			"Marketplace untuk produk UMKM lokal dengan fitur katalog, keranjang, checkout, chat penjual-pembeli, dan sistem review. Platform web, butuh admin panel dan kurir tracking.",
	},
	{
		id: "habit-mobile",
		title: "Habit Tracker Mobile",
		icon: "Smartphone",
		platform: "mobile" as const,
		prompt:
			"Aplikasi mobile habit tracker dengan streak, reminder notifikasi, statistik mingguan, dan social share. Target Gen Z, butuh onboarding gamified dan premium subscription.",
	},
	{
		id: "edu-lms",
		title: "LMS Edukasi",
		icon: "GraduationCap",
		platform: "web" as const,
		prompt:
			"Platform LMS untuk kursus online dengan video streaming, quiz, sertifikat otomatis, dan forum diskusi. Butuh role mentor dan student, payment gateway, dan progress tracking.",
	},
	{
		id: "crm",
		title: "CRM Penjualan",
		icon: "Users",
		platform: "web" as const,
		prompt:
			"CRM untuk tim sales dengan pipeline kanban, reminder follow-up, integrasi WhatsApp, dan laporan performa. Butuh role admin, sales, manager.",
	},
	{
		id: "pos",
		title: "POS Kasir",
		icon: "Receipt",
		platform: "mobile" as const,
		prompt:
			"Aplikasi POS kasir untuk warung dengan scan barcode, cetak struk Bluetooth, laporan harian, dan manajemen stok. Platform mobile Android, offline-first.",
	},
]);

interface CodebaseFeatureTemplate {
	readonly id: string;
	readonly title: string;
	readonly category: string;
	readonly prompt: string;
}

export const CODEBASE_FEATURE_TEMPLATES: readonly CodebaseFeatureTemplate[] =
	freezeCatalog([
	{
		id: "feature-wishlist",
		title: "Wishlist Produk & Favorit",
		category: "Fitur Pengguna",
		prompt:
			"Tambahkan fitur wishlist produk agar pengguna yang sedang login dapat menyimpan item favorit mereka, melihat daftar wishlist di halaman profil, serta menambah atau menghapus produk langsung dari katalog dengan update state seketika.",
	},
	{
		id: "feature-export-reports",
		title: "Ekspor Transaksi CSV & PDF",
		category: "Laporan & Export",
		prompt:
			"Buatkan fungsionalitas ekspor riwayat transaksi ke format file CSV dan PDF dengan filter rentang tanggal, status pesanan, serta pagination data yang efisien tanpa membebani server.",
	},
	{
		id: "feature-oauth-google",
		title: "Integrasi Google OAuth",
		category: "Autentikasi",
		prompt:
			"Tambahkan opsi autentikasi login dan daftar menggunakan Google OAuth ke sistem akun yang sudah berjalan, dengan sinkronisasi data profil pengguna dan penanganan session cookie yang aman.",
	},
	{
		id: "feature-rbac",
		title: "Role & Permission (RBAC)",
		category: "Hak Akses",
		prompt:
			"Implementasikan sistem Role-Based Access Control (Admin, Manager, Staff) untuk mengontrol izin akses endpoint API, mutasi database, dan pembatasan menu di dashboard internal.",
	},
	{
		id: "feature-webhook-notifications",
		title: "Notifikasi Webhook Otomatis",
		category: "Integrasi",
		prompt:
			"Tambahkan pengiriman notifikasi email dan webhook otomatis saat status pembayaran atau pesanan berubah, dilengkapi dengan retry mechanism jika webhook tujuan gagal merespons.",
	},
	{
		id: "feature-dark-mode",
		title: "Dark Mode & Preferensi Tema",
		category: "Antarmuka UI",
		prompt:
			"Tambahkan dukungan mode gelap dan terang pada antarmuka aplikasi dengan pendeteksian preferensi sistem operasi otomatis serta penyimpanan preferensi tema di level user session.",
	},
]);
