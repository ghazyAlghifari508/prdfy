-- One codebase per existing-codebase project. Every statement is guarded on
-- `codebase_id IS NULL` so a partially applied migration can be re-run safely.
INSERT INTO "codebases" ("id", "user_id", "name", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  p."user_id",
  p."name",
  COALESCE(p."created_at", now()),
  now()
FROM "projects" p
WHERE p.project_mode = 'existing_codebase'
  AND p.codebase_id IS NULL;

UPDATE "projects" p
SET codebase_id = c."id"
FROM "codebases" c
WHERE p.codebase_id IS NULL
  AND p.project_mode = 'existing_codebase'
  AND c."user_id" = p."user_id"
  AND c."name" = p."name";

UPDATE "codebase_sync_sessions" s
SET codebase_id = p.codebase_id
FROM "projects" p
WHERE s.codebase_id IS NULL
  AND s."project_id" = p."id"
  AND p.codebase_id IS NOT NULL;

UPDATE "codebase_snapshots" sn
SET codebase_id = p.codebase_id
FROM "projects" p
WHERE sn.codebase_id IS NULL
  AND sn."project_id" = p."id"
  AND p.codebase_id IS NOT NULL;
