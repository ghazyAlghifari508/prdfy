import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

// === TABLES ===
// ponytail: RLS policies dropped - app-level ownership filters (eq(userId, user.id))
// in every query enforce row isolation. Add pgPolicy back if DB-level enforcement
// becomes a requirement (e.g. direct psql access, multi-tenant hardening).

// Users - Better Auth core "user" table (mapped via usePlural). Extra
// columns (fullName/company/role) are app-owned; Better Auth ignores them.
export const users = pgTable("users", {
	id: text("id").primaryKey(),
	email: text("email").notNull().unique(),
	name: text("name").notNull().default(""),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	fullName: text("full_name"),
	company: text("company"),
	role: text("role"),
	isAdmin: boolean("is_admin").notNull().default(false),
	bannedAt: timestamp("banned_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// === BETTER AUTH TABLES ===

export const sessions = pgTable(
	"sessions",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expires_at").notNull(),
		token: text("token").notNull().unique(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
	},
	(t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
	"accounts",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at"),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable("verifications", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Subscriptions
export const subscriptions = pgTable(
	"subscriptions",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		plan: text("plan").notNull().default("free"), // free, pro, hengker
		status: text("status").notNull().default("active"),
		midtransOrderId: text("midtrans_order_id"),
		// Monthly model (spec §4): credits reset every period; leftover credits
		// are forfeited at period end. NULL period on a PAID row = legacy
		// one-time purchase (grandfathered, never expires). NULL on a FREE row
		// is initialized lazily by the write-on-read rollover in credits.ts.
		currentPeriodStart: timestamp("current_period_start"),
		currentPeriodEnd: timestamp("current_period_end"),
		cancelledAt: timestamp("cancelled_at"),
		// Email notification progress: 0 none, 1 = pre-expiry notice,
		// 2..4 = paused reminders D+1/D+7/D+14 (see billing-emails.ts).
		reminderCount: integer("reminder_count").notNull().default(0),
		credits: integer("credits").notNull().default(0),
		creditsUsed: integer("credits_used").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(t) => [
		// Hot path: credits.ts getCreditBalance/consumeCredit query
		// WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
		index("subscriptions_user_id_created_at_idx").on(t.userId, t.createdAt),
	],
);

// Quotas
export const quotas = pgTable(
	"quotas",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		prdUsed: integer("prd_used").default(0),
		prdLimit: integer("prd_limit").default(-1),
		revisionUsed: integer("revision_used").default(0),
		revisionLimit: integer("revision_limit").default(-1),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(t) => [index("quotas_user_id_idx").on(t.userId)],
);

// Projects
export const projects = pgTable(
	"projects",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		name: text("name").notNull(),
		description: text("description"),
		status: text("status").default("draft"),
		mode: text("mode").default("ai_auto"),
		// Existing-codebase project mode: "greenfield" | "existing_codebase".
		// Unrelated to `mode` (Ask generation mode "ai_auto" | "manual").
		// Existing projects default to "greenfield" (greenfield flow unchanged).
		projectMode: text("project_mode").notNull().default("greenfield"),
		language: text("language").default("id"),
		step: text("step").default("prd"), // prd, ac, task
		acStatus: text("ac_status").default("pending"),
		taskStatus: text("task_status").default("pending"),
		shareToken: text("share_token"),
		lastUrl: text("last_url"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(t) => [index("projects_user_id_idx").on(t.userId)],
);

// Prd Versions
export const prdVersions = pgTable(
	"prd_versions",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id),
		version: integer("version").notNull(),
		content: text("content").notNull(),
		changeSummary: text("change_summary"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(t) => [
		// Hot path: prd-service getLatestPrdContent, prd/$id loader
		// WHERE project_id = ? ORDER BY version DESC
		// unique: two concurrent revisions cannot both insert the same version
		uniqueIndex("prd_versions_project_id_version_idx").on(
			t.projectId,
			t.version,
		),
	],
);

// Ac Versions
export const acVersions = pgTable(
	"ac_versions",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id),
		version: integer("version").notNull(),
		content: text("content").notNull(),
		changeSummary: text("change_summary"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(t) => [
		// Hot path: ac-service, kanban loader
		// WHERE project_id = ? ORDER BY version DESC
		// unique: two concurrent revisions cannot both insert the same version
		uniqueIndex("ac_versions_project_id_version_idx").on(
			t.projectId,
			t.version,
		),
	],
);

// Conversations
export const conversations = pgTable(
	"conversations",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		projectId: text("project_id").references(() => projects.id),
		title: text("title"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(t) => [
		index("conversations_user_id_idx").on(t.userId),
		// Hot path: prd/$id loader
		// WHERE project_id = ? ORDER BY created_at DESC LIMIT 1
		index("conversations_project_id_created_at_idx").on(
			t.projectId,
			t.createdAt,
		),
	],
);

// Messages
export const messages = pgTable(
	"messages",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id),
		role: text("role").notNull(), // user, assistant, system
		content: text("content").notNull(),
		metadata: jsonb("metadata"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(t) => [
		// Hot path: chat-service getConversationHistory, prd/$id loader
		// WHERE conversation_id = ? ORDER BY created_at ASC
		index("messages_conversation_id_created_at_idx").on(
			t.conversationId,
			t.createdAt,
		),
	],
);

// Tasks
export const tasks = pgTable(
	"tasks",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id),
		title: text("title").notNull(),
		description: text("description"),
		status: text("status").default("pending"),
		priority: text("priority").default("medium"),
		assignee: text("assignee"),
		dependencies: jsonb("dependencies"),
		subtasks: jsonb("subtasks"),
		position: jsonb("position"), // { x, y } for kanban
		order: integer("order").default(0),
		featureName: text("feature_name"),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(t) => [
		// Hot path: kanban, task-service, v1 API
		// WHERE project_id = ? ORDER BY order ASC
		index("tasks_project_id_order_idx").on(t.projectId, t.order),
	],
);

// Api Keys
export const apiKeys = pgTable(
	"api_keys",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		name: text("name").notNull(),
		key: text("key").notNull().unique(),
		keyPrefix: text("key_prefix"),
		scopes: text("scopes").array(),
		lastUsedAt: timestamp("last_used_at"),
		createdAt: timestamp("created_at").defaultNow(),
		expiresAt: timestamp("expires_at"),
	},
	(t) => [index("api_keys_user_id_idx").on(t.userId)],
);

// Feedback
export const feedback = pgTable(
	"feedback",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").references(() => users.id),
		message: text("message").notNull(),
		type: text("type").default("general"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(t) => [index("feedback_user_id_idx").on(t.userId)],
);

// Error Reports
export const errorReports = pgTable(
	"error_reports",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").references(() => users.id),
		errorMessage: text("error_message").notNull(),
		context: text("context"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(t) => [index("error_reports_user_id_idx").on(t.userId)],
);

// Rate Limits (kustom selain Better Auth)
export const rateLimits = pgTable(
	"rate_limits",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		action: text("action").notNull(),
		windowStart: timestamp("window_start").notNull(),
		count: integer("count").default(1),
	},
	(t) => [index("rate_limits_user_id_action_idx").on(t.userId, t.action)],
);

// Notification Preferences
export const notificationPreferences = pgTable("notification_preferences", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id)
		.unique(),
	quotaWarning: boolean("quota_warning").notNull().default(true),
	prdCompleted: boolean("prd_completed").notNull().default(true),
	paymentUpdates: boolean("payment_updates").notNull().default(true),
	productUpdates: boolean("product_updates").notNull().default(false),
	createdAt: timestamp("created_at").defaultNow(),
	updatedAt: timestamp("updated_at").defaultNow(),
});

// === Existing codebase sync (MVP) ===
// Project-owned sync/session/snapshot/analysis/context records. Every table
// carries project + owner linkage with cascade delete so project deletion
// removes sync data transactionally. Sync credentials persist as hashes only.

// Sync session: one short-lived project-scoped credential per attempt.
export const codebaseSyncSessions = pgTable(
	"codebase_sync_sessions",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		// SHA-256 hex of the raw sync credential. Raw value is never stored.
		credentialHash: text("credential_hash").notNull(),
		// Sync status: waiting_for_cli | connected | scanning | filtering |
		// uploading | uploaded | analyzing | ready | failed | expired.
		status: text("status").notNull().default("waiting_for_cli"),
		expiresAt: timestamp("expires_at").notNull(),
		consumedAt: timestamp("consumed_at"),
		cliMinVersion: text("cli_min_version").notNull().default("2.0.0"),
		attempt: integer("attempt").notNull().default(1),
		metadata: jsonb("metadata"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(t) => [
		index("codebase_sync_sessions_project_id_idx").on(t.projectId),
		index("codebase_sync_sessions_user_id_idx").on(t.userId),
	],
);

// Snapshot: persisted manifest + filtered source-context references.
export const codebaseSnapshots = pgTable(
	"codebase_snapshots",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		syncSessionId: text("sync_session_id")
			.notNull()
			.references(() => codebaseSyncSessions.id, { onDelete: "cascade" }),
		branch: text("branch"),
		commitSha: text("commit_sha"),
		manifest: jsonb("manifest"),
		fileCount: integer("file_count").notNull().default(0),
		excludedCount: integer("excluded_count").notNull().default(0),
		contentSize: integer("content_size").notNull().default(0),
		// Snapshot status uses CODEBASE_SNAPSHOT_STATUSES
		// (see src/lib/codebase-sync.ts); default "uploading" is a member.
		status: text("status").notNull().default("uploading"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(t) => [
		index("codebase_snapshots_project_id_idx").on(t.projectId),
		index("codebase_snapshots_sync_session_id_idx").on(t.syncSessionId),
	],
);

// Snapshot file chunks: bounded base64 text slices keyed by
// (snapshot, path, chunk index). One row per uploaded chunk; completion
// reassembles per path and verifies hashes before the snapshot becomes
// `uploaded`. Raw filtered source is retained for the project lifetime so
// analysis can be regenerated; project deletion cascades everything.
export const codebaseSnapshotFiles = pgTable(
	"codebase_snapshot_files",
	{
		snapshotId: text("snapshot_id")
			.notNull()
			.references(() => codebaseSnapshots.id, { onDelete: "cascade" }),
		path: text("path").notNull(),
		chunkIndex: integer("chunk_index").notNull(),
		chunkTotal: integer("chunk_total").notNull(),
		contentHash: text("content_hash").notNull(),
		encoding: text("encoding").notNull().default("base64"),
		// Base64 text slice as sent by the CLI (binaries never uploaded).
		data: text("data").notNull(),
		// Decoded byte length of `data` for bound accounting without decoding.
		size: integer("size").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(t) => [
		primaryKey({
			columns: [t.snapshotId, t.path, t.chunkIndex],
			name: "codebase_snapshot_files_pkey",
		}),
		index("codebase_snapshot_files_snapshot_id_idx").on(t.snapshotId),
	],
);

// Sync idempotency keys: small stored responses for idempotent replay.
// Keys embed only the attempt identity (`${attemptId}:${kind}:${index}`)
// and carry no credentials; stored responses are status payloads only
// (never tokens or source content).
export const codebaseSyncIdempotencyKeys = pgTable(
	"codebase_sync_idempotency_keys",
	{
		key: text("key").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => codebaseSyncSessions.id, { onDelete: "cascade" }),
		snapshotId: text("snapshot_id")
			.notNull()
			.references(() => codebaseSnapshots.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(),
		statusCode: integer("status_code").notNull(),
		response: jsonb("response").notNull(),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(t) => [
		index("codebase_sync_idempotency_keys_session_id_idx").on(t.sessionId),
	],
);

// Analysis: validated structured output bound to one snapshot.
export const codebaseAnalyses = pgTable(
	"codebase_analyses",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		snapshotId: text("snapshot_id")
			.notNull()
			.references(() => codebaseSnapshots.id, { onDelete: "cascade" }),
		output: jsonb("output"),
		// Analysis status uses CODEBASE_ANALYSIS_STATUSES
		// (see src/lib/codebase-sync.ts); default "pending" is a member.
		status: text("status").notNull().default("pending"),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(t) => [
		index("codebase_analyses_project_id_idx").on(t.projectId),
		index("codebase_analyses_snapshot_id_idx").on(t.snapshotId),
	],
);

// Generation context: links the active snapshot/analysis to later Ask/PRD/AC/
// Task generation without changing existing version-table semantics.
export const codebaseGenerationContexts = pgTable(
	"codebase_generation_contexts",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		snapshotId: text("snapshot_id")
			.notNull()
			.references(() => codebaseSnapshots.id, { onDelete: "cascade" }),
		analysisId: text("analysis_id").references(() => codebaseAnalyses.id, {
			onDelete: "cascade",
		}),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(t) => [
		// Hot paths: latest context per project, plus snapshot/analysis
		// lookups when linking generation output back to its source.
		index("codebase_generation_contexts_project_id_idx").on(t.projectId),
		index("codebase_generation_contexts_snapshot_id_idx").on(t.snapshotId),
		index("codebase_generation_contexts_analysis_id_idx").on(t.analysisId),
	],
);

// Ask handoff: authoritative server-side copy of the Ask answers/compiled
// prompt for existing-codebase projects (one row per project, upserted on
// submit). sessionStorage keeps UI continuity; this row survives refresh and
// multi-device access. Greenfield projects never write here.
export const codebaseAskHandoffs = pgTable("codebase_ask_handoffs", {
	projectId: text("project_id")
		.primaryKey()
		.references(() => projects.id, { onDelete: "cascade" }),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	// Advisory binding to the snapshot the Ask flow saw; plain text (no FK)
	// so later snapshot selection never blocks handoff reads.
	snapshotId: text("snapshot_id"),
	answers: jsonb("answers"),
	compiledPrompt: text("compiled_prompt"),
	// Restorable Ask UI snapshot (questions + both sessions' answers).
	state: jsonb("state"),
	createdAt: timestamp("created_at").defaultNow(),
	updatedAt: timestamp("updated_at").defaultNow(),
});

// Payments
export const payments = pgTable(
	"payments",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		orderId: text("order_id").notNull().unique(),
		plan: text("plan").notNull(),
		amount: integer("amount"),
		status: text("status").default("pending"),
		midtransResponse: jsonb("midtrans_response"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(t) => [index("payments_user_id_idx").on(t.userId)],
);
