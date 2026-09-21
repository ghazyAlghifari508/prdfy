"use client";

import { Check } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface NonTechAnswer {
	value: string;
	isCustom: boolean;
	skipped: boolean;
	/** For multiselect: array of selected option strings */
	values?: string[];
}

type QuestionType = "select" | "text" | "multiselect";

interface QuestionCardProps {
	question: string;
	type: QuestionType;
	options?: string[];
	answer: NonTechAnswer | undefined;
	onAnswer: (answer: NonTechAnswer) => void;
}

export function QuestionCard({
	question,
	type,
	options,
	answer,
	onAnswer,
}: QuestionCardProps) {
	const [customText, setCustomText] = useState("");
	const [showCustomInput, setShowCustomInput] = useState(false);
	const [textInput, setTextInput] = useState(
		answer?.isCustom ? answer.value : "",
	);
	// Skipping stashes the current answer so an accidental skip can be
	// undone without losing the selection or text.
	const skippedBackup = useRef<NonTechAnswer | null>(null);
	// The parent reuses this component across questions: reset local drafts
	// when the question identity changes so one question's text can never
	// be submitted as another's.
	const questionRef = useRef(question);
	if (questionRef.current !== question) {
		questionRef.current = question;
		skippedBackup.current = null;
		setCustomText("");
		setShowCustomInput(false);
		setTextInput(answer?.isCustom ? answer.value : "");
	}

	const isSkipped = answer?.skipped ?? false;

	const toggleSkip = () => {
		if (isSkipped) {
			const restore = skippedBackup.current;
			skippedBackup.current = null;
			onAnswer(restore ?? { value: "", isCustom: false, skipped: false });
		} else {
			if (
				answer &&
				!answer.skipped &&
				(answer.value || (answer.values?.length ?? 0) > 0)
			) {
				skippedBackup.current = answer;
			}
			setShowCustomInput(false);
			onAnswer({ value: "", isCustom: false, skipped: true });
		}
	};

	// multiselect toggle
	const toggleOption = (opt: string) => {
		const current = answer?.values ?? [];
		const next = current.includes(opt)
			? current.filter((v) => v !== opt)
			: [...current, opt];
		onAnswer({
			value: next.join(", "),
			isCustom: false,
			skipped: false,
			values: next,
		});
	};

	const submitCustom = () => {
		if (!customText.trim()) return;
		onAnswer({ value: customText.trim(), isCustom: true, skipped: false });
		// Clear the draft: reopening the editor must start empty, never
		// resubmit a previous answer.
		setCustomText("");
		setShowCustomInput(false);
	};

	const submitText = () => {
		if (!textInput.trim()) return;
		onAnswer({ value: textInput.trim(), isCustom: true, skipped: false });
	};

	return (
		<div
			className="rounded-2xl border border-(--border-subtle) p-6 shadow-(--shadow-surface)"
			style={{ background: "var(--bg-card)" }}
		>
			<div className="mb-4 flex items-start justify-between gap-3">
				<h3
					className="font-inter text-base font-[510]"
					style={{ color: "var(--text-primary)" }}
				>
					{question}
				</h3>
				<button
					type="button"
					onClick={toggleSkip}
					className={cn(
						"shrink-0 rounded-full px-3 py-1 min-h-[44px] inline-flex items-center justify-center font-inter text-xs transition-colors",
						isSkipped ? "bg-steel text-snow" : "text-fog hover:text-snow",
					)}
				>
					{isSkipped ? "Dilewati" : "Lewati"}
				</button>
			</div>

			{isSkipped ? (
				<p className="font-inter text-sm text-fog italic">
					Pertanyaan ini dilewati
				</p>
			) : type === "text" ? (
				answer?.isCustom && answer?.value ? (
					<div className="flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/5 px-3 py-2">
						<Check size={16} className="shrink-0 text-emerald-400" />
						<span
							className="flex-1 truncate font-inter text-sm"
							style={{ color: "var(--text-primary)" }}
						>
							{answer.value}
						</span>
						<button
							type="button"
							onClick={() => {
								setTextInput(answer.value);
								onAnswer({ value: "", isCustom: false, skipped: false });
							}}
							className="font-inter text-xs text-fog hover:text-snow"
						>
							Ubah
						</button>
					</div>
				) : (
					<div className="flex gap-2 min-h-[44px]">
						<input
							type="text"
							value={textInput}
							onChange={(e) => setTextInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									submitText();
								}
							}}
							placeholder="Tulis jawabanmu..."
							className="flex-1 rounded-lg border border-(--border-subtle) px-3 py-2 font-inter text-sm shadow-(--shadow-inset) outline-none"
							style={{
								background: "var(--bg-input)",
								color: "var(--text-primary)",
							}}
						/>
						<button
							type="button"
							onClick={submitText}
							disabled={!textInput.trim()}
							className="btn-primary rounded-lg px-4 py-2 min-h-[44px] flex items-center justify-center text-center font-inter text-sm font-[510] disabled:opacity-40 disabled:cursor-not-allowed"
						>
							Simpan
						</button>
					</div>
				)
			) : type === "multiselect" ? (
				<div className="flex flex-wrap gap-2">
					{options?.map((opt) => {
						const selected = answer?.values?.includes(opt) ?? false;
						return (
							<button
								type="button"
								key={opt}
								onClick={() => toggleOption(opt)}
								className={cn(
									"rounded-full px-4 py-2 min-h-[44px] font-inter text-sm transition-colors",
									selected
										? "btn-primary"
										: "border border-(--border-subtle) text-fog hover:bg-white/5 hover:text-snow",
								)}
							>
								{opt}
							</button>
						);
					})}
				</div>
			) : (
				/* select: original pill options */
				<>
					<div className="flex flex-wrap gap-2">
						{options?.map((opt) => (
							<button
								type="button"
								key={opt}
								onClick={() => {
									setShowCustomInput(false);
									onAnswer({ value: opt, isCustom: false, skipped: false });
								}}
								className={cn(
									"rounded-full px-4 py-2 min-h-[44px] font-inter text-sm transition-colors",
									answer?.value === opt && !answer.isCustom
										? "btn-primary"
										: "border border-(--border-subtle) text-fog hover:bg-white/5 hover:text-snow",
								)}
							>
								{opt}
							</button>
						))}
						<button
							type="button"
							onClick={() => setShowCustomInput(true)}
							className={cn(
								"rounded-full border border-dashed border-(--border-subtle) px-4 py-2 min-h-[44px] flex items-center justify-center text-center font-inter text-sm transition-colors",
								answer?.isCustom
									? "btn-primary border-solid"
									: "text-fog hover:bg-white/5 hover:text-snow",
							)}
						>
							+ Lainnya
						</button>
					</div>
					{showCustomInput && (
						<div className="mt-3 flex gap-2">
							<input
								type="text"
								value={customText}
								onChange={(e) => setCustomText(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										submitCustom();
									}
								}}
								placeholder="Tulis jawabanmu..."
								className="flex-1 rounded-lg border border-(--border-subtle) px-3 py-2 font-inter text-sm shadow-(--shadow-inset) outline-none"
								style={{
									background: "var(--bg-input)",
									color: "var(--text-primary)",
								}}
							/>
							<button
								type="button"
								onClick={submitCustom}
								className="btn-primary rounded-lg px-4 py-2 min-h-[44px] flex items-center justify-center text-center font-inter text-sm font-[510]"
							>
								Simpan
							</button>
						</div>
					)}
					{answer?.isCustom && !showCustomInput && (
						<p className="mt-3 font-inter text-sm text-fog">
							Jawabanmu:{" "}
							<span style={{ color: "var(--text-primary)" }}>
								{answer.value}
							</span>
						</p>
					)}
				</>
			)}
		</div>
	);
}
