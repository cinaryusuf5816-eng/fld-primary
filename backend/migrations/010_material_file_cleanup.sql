-- Deletion commits before bytes are removed. Jobs survive restarts and uncertain cleanup.
CREATE TABLE material_file_cleanup_jobs (
    storage_key TEXT PRIMARY KEY CHECK (storage_key ~ '^[a-f0-9]{64}\.bin$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_attempt_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0)
);
ALTER TABLE material_file_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON material_file_cleanup_jobs FROM PUBLIC;
DO $$ DECLARE api_role TEXT;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
            EXECUTE format('REVOKE ALL ON material_file_cleanup_jobs FROM %I',api_role);
        END IF;
    END LOOP;
END $$;
