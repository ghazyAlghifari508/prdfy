// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionCard, type NonTechAnswer } from "./question-card";

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(() => {
	if (root) {
		const currentRoot = root;
		act(() => {
			currentRoot.unmount();
		});
		root = null;
	}
	container?.remove();
});

function renderCard(props: {
	question: string;
	answer: NonTechAnswer | undefined;
	onAnswer: (answer: NonTechAnswer) => void;
}) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root?.render(
			<QuestionCard
				question={props.question}
				type="text"
				answer={props.answer}
				onAnswer={props.onAnswer}
			/>,
		);
	});
	return container;
}

function setInputValue(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set;
	act(() => {
		setter?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

describe("QuestionCard", () => {
	it("resets the text draft when reused for another question", () => {
		const onAnswer = vi.fn();
		const rendered = renderCard({
			question: "First question?",
			answer: undefined,
			onAnswer,
		});
		const input = rendered.querySelector("input");
		expect(input).not.toBeNull();
		setInputValue(input as HTMLInputElement, "<stale draft>");

		act(() => {
			root?.render(
				<QuestionCard
					question="Second question?"
					type="text"
					answer={undefined}
					onAnswer={onAnswer}
				/>,
			);
		});

		expect(
			(rendered.querySelector("input") as HTMLInputElement | null)?.value,
		).toBe("");
	});

	it("restores the previous answer when a skip is undone", () => {
		let current: NonTechAnswer | undefined = {
			value: "<picked option>",
			isCustom: false,
			skipped: false,
		};
		const onAnswer = vi.fn((next: NonTechAnswer) => {
			current = next;
		});
		const rendered = renderCard({
			question: "Pick one?",
			answer: current,
			onAnswer,
		});

		const skipButton = Array.from(rendered.querySelectorAll("button")).find(
			(b) => b.textContent === "Lewati",
		);
		expect(skipButton).toBeDefined();
		act(() => {
			skipButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(current?.skipped).toBe(true);

		act(() => {
			root?.render(
				<QuestionCard question="Pick one?" type="text" answer={current} onAnswer={onAnswer} />,
			);
		});
		const undoButton = Array.from(rendered.querySelectorAll("button")).find(
			(b) => b.textContent === "Dilewati",
		);
		expect(undoButton).toBeDefined();
		act(() => {
			undoButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(current).toEqual({
			value: "<picked option>",
			isCustom: false,
			skipped: false,
		});
	});
});
