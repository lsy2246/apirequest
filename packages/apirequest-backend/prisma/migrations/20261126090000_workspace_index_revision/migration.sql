-- A cheap, durable change token for the local workspace collection index.
-- Statement triggers bump it once per changed owner, including bulk imports.
CREATE TABLE "WorkspaceIndexRevision" (
    "userUid" TEXT NOT NULL PRIMARY KEY,
    "revision" UUID NOT NULL DEFAULT gen_random_uuid()
);

-- Existing workspaces need a token before their first post-migration write.
INSERT INTO "WorkspaceIndexRevision" ("userUid", "revision")
SELECT "userUid", gen_random_uuid() FROM (
    SELECT "userUid" FROM "UserCollection"
    UNION
    SELECT "userUid" FROM "UserRequest"
) existing_owners;

CREATE FUNCTION bump_workspace_index_revision() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO "WorkspaceIndexRevision" ("userUid", "revision")
        SELECT "userUid", gen_random_uuid() FROM (SELECT DISTINCT "userUid" FROM inserted_rows) owners
        ON CONFLICT ("userUid") DO UPDATE
          SET "revision" = gen_random_uuid();
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO "WorkspaceIndexRevision" ("userUid", "revision")
        SELECT "userUid", gen_random_uuid() FROM (SELECT DISTINCT "userUid" FROM deleted_rows) owners
        ON CONFLICT ("userUid") DO UPDATE
          SET "revision" = gen_random_uuid();
    ELSE
        INSERT INTO "WorkspaceIndexRevision" ("userUid", "revision")
        SELECT "userUid", gen_random_uuid() FROM (
            SELECT "userUid" FROM inserted_rows
            UNION
            SELECT "userUid" FROM deleted_rows
        ) changed_owners WHERE true
        ON CONFLICT ("userUid") DO UPDATE
          SET "revision" = gen_random_uuid();
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_request_index_insert AFTER INSERT ON "UserRequest"
REFERENCING NEW TABLE AS inserted_rows FOR EACH STATEMENT
EXECUTE FUNCTION bump_workspace_index_revision();
CREATE TRIGGER user_request_index_update AFTER UPDATE ON "UserRequest"
REFERENCING OLD TABLE AS deleted_rows NEW TABLE AS inserted_rows FOR EACH STATEMENT
EXECUTE FUNCTION bump_workspace_index_revision();
CREATE TRIGGER user_request_index_delete AFTER DELETE ON "UserRequest"
REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
EXECUTE FUNCTION bump_workspace_index_revision();

CREATE TRIGGER user_collection_index_insert AFTER INSERT ON "UserCollection"
REFERENCING NEW TABLE AS inserted_rows FOR EACH STATEMENT
EXECUTE FUNCTION bump_workspace_index_revision();
CREATE TRIGGER user_collection_index_update AFTER UPDATE ON "UserCollection"
REFERENCING OLD TABLE AS deleted_rows NEW TABLE AS inserted_rows FOR EACH STATEMENT
EXECUTE FUNCTION bump_workspace_index_revision();
CREATE TRIGGER user_collection_index_delete AFTER DELETE ON "UserCollection"
REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
EXECUTE FUNCTION bump_workspace_index_revision();

CREATE INDEX "UserCollection_userUid_orderIndex_id_idx"
    ON "UserCollection" ("userUid", "orderIndex", "id");

-- Keep navigation fields narrow and indexed instead of opening each request
-- JSON document whenever a workspace index changes.
CREATE TABLE "UserRequestSummary" (
    "id" TEXT NOT NULL PRIMARY KEY REFERENCES "UserRequest"("id") ON DELETE CASCADE,
    "userUid" TEXT NOT NULL,
    "collectionID" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "updatedOn" TIMESTAMPTZ(3) NOT NULL,
    "refID" TEXT,
    "method" TEXT,
    "endpoint" TEXT,
    "gql" BOOLEAN NOT NULL,
    "hasResponses" BOOLEAN NOT NULL
);
CREATE INDEX "UserRequestSummary_userUid_orderIndex_id_idx"
    ON "UserRequestSummary" ("userUid", "orderIndex", "id");
CREATE INDEX "UserRequestSummary_userUid_collectionID_orderIndex_id_idx"
    ON "UserRequestSummary" ("userUid", "collectionID", "orderIndex", "id");
-- Substring searches in the sidebar and spotlight need indexed title/URL lookup.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "UserRequestSummary_title_trgm_idx"
    ON "UserRequestSummary" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "UserRequestSummary_endpoint_trgm_idx"
    ON "UserRequestSummary" USING GIN ("endpoint" gin_trgm_ops);

INSERT INTO "UserRequestSummary" (
    "id", "userUid", "collectionID", "title", "orderIndex", "updatedOn",
    "refID", "method", "endpoint", "gql", "hasResponses"
)
SELECT r.id, r."userUid", r."collectionID", r.title, r."orderIndex", r."updatedOn",
       d."_ref_id", d.method, COALESCE(d.endpoint, d.url),
       (d.query IS NOT NULL AND d.url IS NOT NULL AND d.endpoint IS NULL),
       COALESCE(d.responses <> '{}'::jsonb, false)
FROM "UserRequest" r
CROSS JOIN LATERAL jsonb_to_record(
  CASE WHEN jsonb_typeof(r.request) = 'object' THEN r.request ELSE '{}'::jsonb END
)
  AS d("_ref_id" text, method text, endpoint text, url text, query text, responses jsonb);

CREATE FUNCTION sync_user_request_summary() RETURNS trigger AS $$
BEGIN
    INSERT INTO "UserRequestSummary" (
        "id", "userUid", "collectionID", "title", "orderIndex", "updatedOn",
        "refID", "method", "endpoint", "gql", "hasResponses"
    ) VALUES (
        NEW.id, NEW."userUid", NEW."collectionID", NEW.title, NEW."orderIndex", NEW."updatedOn",
        NEW.request ->> '_ref_id', NEW.request ->> 'method',
        COALESCE(NEW.request ->> 'endpoint', NEW.request ->> 'url'),
        (NEW.request ->> 'query' IS NOT NULL AND NEW.request ->> 'url' IS NOT NULL
         AND NEW.request ->> 'endpoint' IS NULL),
        COALESCE(NEW.request -> 'responses' <> '{}'::jsonb, false)
    )
    ON CONFLICT ("id") DO UPDATE SET
        "userUid" = EXCLUDED."userUid",
        "collectionID" = EXCLUDED."collectionID",
        "title" = EXCLUDED."title",
        "orderIndex" = EXCLUDED."orderIndex",
        "updatedOn" = EXCLUDED."updatedOn",
        "refID" = EXCLUDED."refID",
        "method" = EXCLUDED."method",
        "endpoint" = EXCLUDED."endpoint",
        "gql" = EXCLUDED."gql",
        "hasResponses" = EXCLUDED."hasResponses";
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_request_summary_sync
AFTER INSERT OR UPDATE ON "UserRequest"
FOR EACH ROW EXECUTE FUNCTION sync_user_request_summary();
