export interface FaqItem {
	id: string;
	title: string;
	subtitle: string;
	content: string;
	icon: "spark" | "workflow" | "document" | "board" | "credit" | "feedback";
}

export const FAQ_ITEMS: FaqItem[] = [
	{
		id: "product-output",
		title: "Apa yang bisa dibuat dengan PrdFy?",
		subtitle: "Ubah ide produk menjadi dokumen kerja",
		content:
			"PrdFy membantu menyusun PRD, acceptance criteria, task tree, dan Kanban dari satu ide produk. Hasilnya bisa kamu baca, revisi, dan lanjutkan sebagai dasar kerja tim.",
		icon: "spark",
	},
	{
		id: "guided-flow",
		title: "Bagaimana alur kerja PrdFy?",
		subtitle: "Jawab pertanyaan yang menentukan arah produk",
		content:
			"Mulai dari ide produk, jawab pertanyaan klarifikasi, lalu PrdFy menyusun PRD dengan delapan bagian. Setelah itu kamu bisa melanjutkan ke acceptance criteria, task tree, dan Kanban.",
		icon: "workflow",
	},
	{
		id: "prd-revision",
		title: "Apakah PRD bisa direvisi?",
		subtitle: "Perbaiki bagian tertentu tanpa menulis ulang semuanya",
		content:
			"Bisa. Kamu dapat meminta revisi pada PRD melalui chat. Revisi hanya memperbarui bagian yang diminta dan tidak memakai credit tambahan.",
		icon: "document",
	},
	{
		id: "task-kanban",
		title: "Apa hubungan PRD, Task, dan Kanban?",
		subtitle: "Dari keputusan produk sampai pekerjaan yang bisa dilacak",
		content:
			"PRD menjelaskan produk, acceptance criteria merinci kondisi penerimaan, dan task tree memecah pekerjaan. Task tersebut kemudian dapat dilacak melalui board Kanban.",
		icon: "board",
	},
	{
		id: "credits",
		title: "Kapan credit digunakan?",
		subtitle: "Satu credit untuk satu proses generate",
		content:
			"Satu credit digunakan untuk satu generate PRD, acceptance criteria, atau task. Revisi dokumen tetap gratis dan tidak mengurangi credit.",
		icon: "credit",
	},
	{
		id: "feedback",
		title: "Bagaimana cara memberi masukan?",
		subtitle: "Laporkan bug atau usulkan fitur dari Settings",
		content:
			"Buka Settings lalu pilih Feedback. Kamu bisa mengirim laporan bug atau usulan fitur dari halaman tersebut.",
		icon: "feedback",
	},
];
