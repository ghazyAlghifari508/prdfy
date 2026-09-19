# Comprehensive Directive: Anti-AI-Slop & High-Utility Product Design

> **MANDATORY SYSTEM DIRECTIVE FOR ALL AI AGENTS, ENGINEERS, AND REVIEWERS**
>
> This document is the authoritative rulebook for all user interface, layout, typography, interaction, and visual styling work in **PRDFY**.
>
> ### Core Synthesis:
> 1. **PRODUCT CONCEPT & VALUE PROPOSITION: PRDFY**
>    PRDFY is an AI-powered product development workspace that transforms initial product ideas into complete, professional PRDs (8 sections), acceptance criteria (AC), task trees, and interactive Kanban boards within minutes.
>
> 2. **VISUAL DESIGN LANGUAGE: Clean, High-Utility Developer-Grade SaaS**
>    The interface embodies the clean, structured, content-first aesthetic of high-tier developer tools (Linear, GitHub, Vercel):
>    - Primary canvas: Clean neutral background with crisp contrast across light/dark themes
>    - Dominant typography: Crisp sans-serif with confident scale and monospace for technical IDs/code
>    - Secondary metadata: Muted graphite / neutral zinc for timestamps, tokens, and secondary notes
>    - Structural hairline borders: Fine 1px borders (`border-border`) establishing hierarchy without heavy shadows
>    - Primary actions: High-contrast solid buttons (`bg-primary text-primary-foreground`) or clean outlined borders
>    - Elevation: Architectural flat utility with razor-sharp 1px structural borders instead of muddy drop shadows
>
> ### The Core Mandate: Eradicating "Scared AI Syndrome"
> There are two equal and opposite failures in AI-generated software:
> - **Failure Mode A ("Cheap AI Slop"):** Tacky multi-color neon rainbow gradients, murky cartoonish 3D drop-shadows, nested capsule pills, pastel icon circles, and gratuitous emoji spam in UI chrome.
> - **Failure Mode B ("Scared AI Wireframe"):** Stripping the page down to a bare, sterile void with two lines of 12px text, empty boxes, and zero visual hierarchy out of fear of making a mistake.
>
> **BOTH MODES ARE UNACCEPTABLE FAILURES.**
> You are expected to design with **craft, courage, density, and discipline** — building rich, confident, fully formed SaaS surfaces that founders, product managers, and developers trust.

---

## 1. Complete Catalog of Prohibited AI Slop (Negative Constraints)

Any pull request, commit, or generated component containing the following patterns will be rejected immediately:

### 1.1 No "Pill-upon-Pill" Nesting (Nested Capsules)
- **The Slop:** Nesting rounded-full pill badges inside rounded-full pill buttons inside rounded-full cards, turning the entire screen into an amorphous cluster of lozenges.
- **The Rule:**
  - Cards, panels, and structural containers MUST use rectangular geometry with disciplined corner rounding: `rounded-xl` (`10px`–`12px`) or `rounded-lg` (`8px`).
  - Form inputs, textareas, and dropdown menus use `rounded-md` or `rounded-lg` (`6px`–`8px`).
  - Standalone category filter chips, status badges, or discrete tags may use `rounded-full`, but they must NEVER contain nested pill badges within themselves.
  - Geometry must convey structural hierarchy: outer containers are stable boxes; only discrete, clickable chips or status pills take pill forms.

### 1.2 No Muddy, Exaggerated 3D Shadows
- **The Slop:** Applying massive, dark, blurry box-shadows (such as `shadow-xl`, `shadow-2xl`, or `shadow-[0_25px_50px_rgba(0,0,0,0.5)]`) to make flat UI cards appear to float off the screen like glossy stickers.
- **The Rule:**
  - Elevation is flat and architectural. Depth is established through **1px hairline borders** (`border border-border`), background value contrast, and disciplined whitespace.
  - Drop shadows are prohibited on cards, list items, hero banners, and inline panels.
  - Exception: High-priority floating overlays (dropdown menus, popover dialogs, modal dialogs, tooltips) may use a subtle, tight, professional shadow (`shadow-sm` or `shadow-md` with low opacity).

### 1.3 No Neon Rainbow Gradients & Glowing Borders
- **The Slop:** Using garish multi-colored gradient text (e.g. purple-to-pink-to-cyan), pulsating glowing outline rings (`ring-2 ring-cyan-400 shadow-[0_0_20px_...]`), or multi-colored card backgrounds.
- **The Rule:**
  - The palette is disciplined: clean neutrals, crisp borders, and focused functional semantic accents (success green, destructive red, warning amber, primary brand highlight).
  - Gradient text is forbidden on standard interface copy and headlines.
  - Buttons use solid fills or clean outlined borders (`border border-border hover:bg-muted/50`).
  - Borders are static, razor-sharp, and neutral.

### 1.4 No Emoji Littering in UI Chrome
- **The Slop:** Prepending or appending emojis to navigation items, action buttons, table column headers, and status badges (e.g. `🚀 Generate PRD`, `✨ AI Magic`, `🔥 Hengker Plan`, `💡 Pro Tip`).
- **The Rule:**
  - UI chrome (navbar, sidebar, buttons, tabs, column headers, status badges) must be 100% free of emojis.
  - Use monochromatic, crisp, hairline SVG line icons (Lucide React).
  - Icons must be functional indicators, sized strictly at `16px` to `20px` with a `1.5px` to `2px` stroke weight, inheriting text color or using semantic tokens.
  - Emojis are only allowed if explicitly authored inside the user's generated markdown content or user-entered text.

### 1.5 No Pastel Icon Circle Blobs
- **The Slop:** Wrapping every single SVG icon inside a rounded pastel-colored circle or square (e.g. a light-purple circle with a purple icon, a light-green circle with a green icon) stacked across feature cards.
- **The Rule:**
  - Icons should sit cleanly and naturally alongside typography or inside a neutral container.
  - If a dedicated icon container is required, use a crisp hairline border (`border border-border bg-muted/30`) with a neutral icon stroke.

### 1.6 No "Hospital Wireframe" Laziness (The Empty Void)
- **The Slop:** Rendering a page as a lone input box or two lines of plain text centered in an ocean of blank white space, calling it "minimalism".
- **The Rule:**
  - Minimalism means purposeful density and ruthless utility, NOT lack of content.
  - Every page must feature balanced layout composition: structured headers, informative secondary metadata, rich data presentation, clear action zones, and comprehensive contextual copy in Indonesian.

---

## 2. UI Component Discovery and Reuse Protocol

Before building custom UI components:

1. **Search existing repository components:** Check `src/components/ui/` and feature directories (`src/components/chat/`, `src/components/prd/`, `src/components/kanban/`, `src/components/task/`, `src/components/settings/`).
2. **Evaluate shadcn/ui & Radix UI primitives:** Use `shadcn-component-discovery` skill or existing registry components.
3. **Compatibility check:** Ensure compatibility with React 19, Tailwind CSS 4, and TanStack Start file-based routing.
4. **Accessibility (a11y):** Maintain semantic HTML, ARIA attributes, keyboard navigation (`Tab`, `Enter`, `Space`, `Escape`), and focus-visible rings (`focus-visible:ring-2 focus-visible:ring-ring`).
5. **Surgical adoption:** Import only the required component or primitive. Do not copy full arbitrary page layouts when only a single widget is needed.

---

## 3. Creative Architecture: How to Build Rich PRDFY Surfaces

When designing any screen or component in PRDFY, apply the following design engineering principles:

### 3.1 Confident Typographic Scale & Hierarchy
- **Primary Hero / Title:** Bold, prominent, and commanding. `text-3xl sm:text-4xl lg:text-5xl`, `font-bold` to `font-extrabold`, tracking `tracking-tight`.
- **Section Headers:** `text-xl sm:text-2xl`, `font-semibold` or `font-bold`.
- **Panel & Card Headers:** `text-base sm:text-lg`, `font-semibold`.
- **Standard Body & Interface Labels:** `text-sm sm:text-base` (`14px`–`16px`), font weight `400` or `500`.
- **Secondary Metadata, Timestamps & Badges:** `text-xs` (`11px`–`12px`), font weight `500` in muted text, using tabular numbers (`font-mono` or `tabular-nums`) for credits, versions, and dates.

### 3.2 Rich Layout Composition & Visual Density
- **Global Navigation:**
  - Clean branding wordmark, route breadcrumbs / stage flow indicator (`Ask -> PRD -> AC -> Task -> Kanban`), credit balance badge (e.g. `Kredit: 12/30`), and user profile dropdown.
- **PRD Viewer Surface:**
  - Table of contents sticky sidebar for rapid navigation across the 8 sections.
  - Formatted markdown with code syntax highlighting, Mermaid diagram rendering, and section revision patch indicators.
  - Version history toolbar with diff viewer and export options (Markdown, ZIP).
- **Kanban Board Surface:**
  - Clear column geometry (Backlog, Todo, In Progress, Review, Done) with task counters.
  - Task cards showing feature name badges, priority indicators, subtask completion progress, and drag-and-drop affordances.
- **Chat & Generation Panel:**
  - Resizable or dockable panel alongside the main content canvas.
  - Streaming SSE updates with typewriter reveal animation for reasoning models.
  - Structured quick-reply pills, model picker (plan-gated), and clear prompt input.

### 3.3 Exhaustive State Engineering (Never Leave a Broken State)
Every interactive surface must be explicitly designed for four fundamental states:
1. **Interactive / Active State:** Full data loaded, high visual hierarchy, clear hover and keyboard focus rings.
2. **Empty State:**
   - Informative, welcoming container explaining what belongs here.
   - Clear primary CTA button (e.g. *"Buat Proyek Baru"*, *"Generate PRD Sekarang"*).
   - Brief checklist or diagram illustrating how the feature operates.
3. **Loading / Streaming State:**
   - Skeleton screens MUST strictly match the geometry of the target content (title bar, section headers, text lines).
   - Indeterminate progress or real stage indicator (never invent a rotating fake sequence).
   - Safe typewriter reveal for streaming AI responses.
4. **Error / Recovery State:**
   - Structured error banner with a neutral, helpful explanation in Indonesian.
   - Distinct, accessible *"Coba Lagi"* (Retry) button with keyboard support.
   - Clear recovery path (e.g. credit exhaustion modal with upgrade CTA, session expiry redirect).

---

## 4. Verification & QA Checklist

Before finalizing any frontend or UI work, verify:
- [ ] **No AI Slop Check:** Are there zero 3D drop-shadows, zero pastel icon circles, zero emoji in UI chrome, and zero nested pills?
- [ ] **No Scared Minimalist Check:** Does the screen look like a real, rich, finished commercial SaaS product rather than an abandoned wireframe?
- [ ] **Typography Check:** Is there strong visual contrast between title, section headers, body, and metadata?
- [ ] **State Completeness Check:** Are loading, empty, and error states fully designed with actionable next steps?
- [ ] **A11y & Keyboard Check:** Can all interactions be operated via keyboard? Are focus-visible rings clearly visible?
- [ ] **Responsive Verification:** Does the interface adapt seamlessly from 320px mobile up to 1440px desktop without horizontal overflow?
- [ ] **Indonesian Copy Check:** Is all user-facing copy in clean, professional Bahasa Indonesia without translating standard technical terms?
