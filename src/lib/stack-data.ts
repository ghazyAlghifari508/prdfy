// Tech-stack option lists for the /ask session-2 dropdowns.
// Options stay plain strings (selection value = label). Icon rendering is a
// pure lookup against STACK_ICONS; missing slug = no icon.
// Icons are served from /public/icons/<slug>.svg (self-hosted, no CDN dependency).
// ponytail: options as strings keeps selection/persistence schema untouched;
// a separate icon map avoids touching StackDropdown's onChange(string) contract.

export const FRONTEND_WEB_OPTIONS = [
	"React (Vite)",
	"Next.js",
	"Vue.js",
	"Nuxt",
	"Svelte",
	"SvelteKit",
	"Astro",
	"Angular",
	"Remix",
	"Solid",
	"Qwik",
	"Lit",
	"Preact",
	"TanStack Start",
	"Native HTML/CSS/JS",
];

export const FRONTEND_MOBILE_OPTIONS = [
	"Flutter",
	"React Native",
	"Expo",
	"Native iOS (Swift)",
	"Native Android (Kotlin)",
	"Ionic",
	"Capacitor",
];

export const BACKEND_OPTIONS = [
	"Express.js",
	"Fastify",
	"NestJS",
	"Hono",
	"Node.js",
	"Bun",
	"Deno",
	"Go",
	"Python (FastAPI)",
	"Python (Django)",
	"Python (Flask)",
	"Ruby on Rails",
	"Spring Boot",
	"ASP.NET",
	"Phoenix (Elixir)",
	"Supabase (BaaS)",
	"Firebase (BaaS)",
	"Convex (BaaS)",
	"Insforge (BaaS)",
	"Appwrite (BaaS)",
];

export const FULLSTACK_FRAMEWORK_OPTIONS = [
	"Next.js (FE+BE)",
	"Nuxt.js (FE+BE)",
	"SvelteKit (FE+BE)",
	"Remix (FE+BE)",
	"Astro (FE+BE)",
	"TanStack Start (FE+BE)",
	"Laravel Blade",
	"Laravel + React (Inertia)",
	"Laravel + Vue (Inertia)",
	"RedwoodJS",
	"SolidStart",
	"Wasp (Fullstack)",
];

/** Mobile full-stack: mobile FE + backend bundled as one stack. */
export const FULLSTACK_MOBILE_OPTIONS = [
	"Flutter + Dart Frog",
	"React Native + Expo + Node.js",
	"KMP (Kotlin Multiplatform)",
	"Ionic + Capacitor + Node.js",
	"React Native + Supabase",
];

export const DATABASE_OPTIONS = [
	"PostgreSQL",
	"Supabase Postgres",
	"Neon",
	"MySQL",
	"MariaDB",
	"SQLite",
	"Turso",
	"MongoDB",
	"Redis",
	"Planetscale",
	"CockroachDB",
	"Firebase Firestore",
	"SurrealDB",
];

export const DEPLOYMENT_OPTIONS = [
	"Vercel",
	"Netlify",
	"Cloudflare Pages",
	"Railway",
	"Render",
	"Fly.io",
	"Heroku",
	"DigitalOcean",
	"AWS",
	"Google Cloud",
	"Azure",
	"Docker/K8s (self-hosted)",
	"Coolify",
	"VPS Manual",
	"GitHub Pages",
];

/** Mobile deployment: app stores + OTA + mobile-specific CI/CD. */
export const DEPLOYMENT_MOBILE_OPTIONS = [
	"App Store + Google Play",
	"Expo EAS",
	"TestFlight + Play Console",
	"Firebase App Distribution",
	"VPS Manual",
	"Docker/K8s (self-hosted)",
];

/** Exact label → icon slug (filename in /public/icons/<slug>.svg). */
export const STACK_ICONS: Record<string, string> = {
	// frontend web
	"React (Vite)": "vite",
	"Next.js": "nextdotjs",
	"Vue.js": "vuedotjs",
	Nuxt: "nuxtdotjs",
	Svelte: "svelte",
	SvelteKit: "svelte",
	Astro: "astro",
	Angular: "angular",
	Remix: "remix",
	Solid: "soliddotjs",
	Qwik: "qwik",
	Lit: "lit",
	Preact: "preact",
	"TanStack Start": "tanstack",
	"Native HTML/CSS/JS": "html5",
	// frontend mobile
	Flutter: "flutter",
	"React Native": "react",
	Expo: "expo",
	"Native iOS (Swift)": "swift",
	"Native Android (Kotlin)": "kotlin",
	Ionic: "ionic",
	Capacitor: "capacitor",
	// backend
	"Express.js": "express",
	Fastify: "fastify",
	NestJS: "nestjs",
	Hono: "hono",
	"Node.js": "nodedotjs",
	Bun: "bun",
	Deno: "deno",
	Go: "go",
	"Python (FastAPI)": "python",
	"Python (Django)": "django",
	"Python (Flask)": "flask",
	"Ruby on Rails": "rubyonrails",
	"Spring Boot": "springboot",
	"ASP.NET": "dotnet",
	"Phoenix (Elixir)": "elixir",
	"Supabase (BaaS)": "supabase",
	"Firebase (BaaS)": "firebase",
	"Convex (BaaS)": "convex",
	"Insforge (BaaS)": "insforge",
	"Appwrite (BaaS)": "appwrite",
	// fullstack mobile
	"Flutter + Dart Frog": "flutter",
	"React Native + Expo + Node.js": "expo",
	"KMP (Kotlin Multiplatform)": "kotlin",
	"Ionic + Capacitor + Node.js": "ionic",
	"React Native + Supabase": "supabase",
	// fullstack
	"Next.js (FE+BE)": "nextdotjs",
	"Nuxt.js (FE+BE)": "nuxtdotjs",
	"SvelteKit (FE+BE)": "svelte",
	"Remix (FE+BE)": "remix",
	"Astro (FE+BE)": "astro",
	"TanStack Start (FE+BE)": "tanstack",
	"Laravel Blade": "laravel",
	"Laravel + React (Inertia)": "laravel",
	"Laravel + Vue (Inertia)": "laravel",
	RedwoodJS: "redwoodjs",
	SolidStart: "soliddotjs",
	// NOTE: no "Wasp (Fullstack)" mapping — public/icons/wasp.svg does not
	// exist and stackIconUrl must never emit a URL with no asset behind it
	// (consumers render null as "no icon"). Add the SVG before re-adding.
	// database
	PostgreSQL: "postgresql",
	"Supabase Postgres": "supabase",
	Neon: "neon",
	MySQL: "mysql",
	MariaDB: "mariadb",
	SQLite: "sqlite",
	Turso: "libsql",
	MongoDB: "mongodb",
	Redis: "redis",
	Planetscale: "planetscale",
	CockroachDB: "cockroachlabs",
	"Firebase Firestore": "firebase",
	SurrealDB: "surrealdb",
	// deployment
	Vercel: "vercel",
	Netlify: "netlify",
	"Cloudflare Pages": "cloudflare",
	Railway: "railway",
	Render: "render",
	"Fly.io": "flydotio",
	Heroku: "heroku",
	DigitalOcean: "digitalocean",
	AWS: "amazonwebservices",
	"Google Cloud": "googlecloud",
	Azure: "microsoftazure",
	"Docker/K8s (self-hosted)": "docker",
	Coolify: "coolify",
	"VPS Manual": "server",
	"GitHub Pages": "github",
	// deployment mobile
	"App Store + Google Play": "appstore",
	"Expo EAS": "eas",
	"TestFlight + Play Console": "testflight",
	"Firebase App Distribution": "firebaseappdistribution",
};

/** Build the local icon path for a label, or null when no slug exists. */
export function stackIconUrl(label: string): string | null {
	const slug = STACK_ICONS[label];
	return slug ? `/icons/${slug}.svg` : null;
}

/** Slugs whose SVGs have black fill (#000000) and need invert on dark bg only. */
const BLACK_FILL_SLUGS = new Set([
	"bun",
	"deno",
	"fastify",
	"nextdotjs",
	"planetscale",
	"remix",
	"render",
	"tanstack",
	"vercel",
	"appstore",
	"testflight",
]);

/** Whether this label's icon needs CSS invert only in dark mode (black-fill SVGs). */
export function stackIconNeedsDarkInvert(label: string): boolean {
	const slug = STACK_ICONS[label];
	return slug ? BLACK_FILL_SLUGS.has(slug) : false;
}
