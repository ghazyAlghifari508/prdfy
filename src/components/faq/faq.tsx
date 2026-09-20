"use client";

import {
	BarChart3,
	ChevronDown,
	CircleDollarSign,
	FileText,
	Lightbulb,
	MessageSquarePlus,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { FAQ_ITEMS } from "./faq-data";

const FAQ_ICONS = {
	spark: Lightbulb,
	workflow: BarChart3,
	document: FileText,
	board: BarChart3,
	credit: CircleDollarSign,
	feedback: MessageSquarePlus,
} as const;

function FaqItem({ item }: { item: (typeof FAQ_ITEMS)[number] }) {
	const Icon = FAQ_ICONS[item.icon];
	const [isOpen, setIsOpen] = useState(false);
	const [panelHeight, setPanelHeight] = useState("0px");
	const panelContentRef = useRef<HTMLDivElement>(null);
	const panelId = `${item.id}-answer`;
	const triggerId = `${item.id}-trigger`;

	useLayoutEffect(() => {
		const nextHeight = isOpen
			? `${panelContentRef.current?.scrollHeight ?? 0}px`
			: "0px";
		setPanelHeight(nextHeight);
	}, [isOpen]);

	return (
		<section className="group/item border-b border-graphite last:border-b-0">
			<h2>
				<button
					type="button"
					id={triggerId}
					aria-controls={panelId}
					aria-expanded={isOpen}
					className="group flex min-h-[76px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo sm:px-5"
					onClick={() => setIsOpen((value) => !value)}
				>
					<Icon
						aria-hidden="true"
						className="size-11 shrink-0 text-indigo transition-transform duration-300 ease-out group-hover/item:rotate-[-10deg] group-hover/item:scale-110"
						strokeWidth={1.7}
					/>
					<span className="flex min-w-0 flex-1 flex-col gap-0">
						<span className="font-inter text-sm font-[510] leading-5 text-snow">
							{item.title}
						</span>
						<span className="font-inter text-sm leading-6 text-fog">
							{item.subtitle}
						</span>
					</span>
					<span
						className={`text-fog transition-transform duration-300 ease-out motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
					>
						<ChevronDown aria-hidden="true" className="size-4" />
					</span>
				</button>
			</h2>
			<section
				id={panelId}
				aria-labelledby={triggerId}
				aria-hidden={!isOpen}
				className="overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none"
				style={{ height: panelHeight }}
			>
				<div
					ref={panelContentRef}
					className="border-t border-graphite/70 px-4 pb-5 pt-3 pl-[76px] font-inter text-sm leading-7 text-fog sm:px-5 sm:pl-[76px]"
				>
					{item.content}
				</div>
			</section>
		</section>
	);
}

export function Faq() {
	return (
		<main className="min-h-[calc(100vh-3.5rem)] bg-onyx px-4 py-12 sm:px-6 sm:py-20">
			<div className="mx-auto max-w-xl">
				<header className="mb-8 text-center">
					<h1 className="font-inter text-3xl font-[620] tracking-tight text-snow sm:text-4xl">
						Cara kerja PrdFy
					</h1>
					<p className="mx-auto mt-3 max-w-md font-inter text-sm leading-6 text-fog sm:text-base">
						Jawaban singkat tentang cara PrdFy mengubah ide menjadi rencana
						produk yang bisa dikerjakan.
					</p>
				</header>

				<div className="w-full overflow-hidden rounded-2xl border border-graphite bg-charcoal">
					{FAQ_ITEMS.map((item) => (
						<FaqItem key={item.id} item={item} />
					))}
				</div>

				<p className="mt-6 text-center font-inter text-sm text-fog">
					Masih ada yang ingin ditanyakan?{" "}
					<a
						href="/settings/feedback"
						className="font-[510] text-snow underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
					>
						Kirim feedback
					</a>
				</p>
			</div>
		</main>
	);
}
