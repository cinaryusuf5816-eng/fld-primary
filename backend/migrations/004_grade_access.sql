-- Empty teacher assignments grant no grade data. Existing users are retained.
CREATE FUNCTION fld_valid_grades(value TEXT[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT value IS NOT NULL
        AND COALESCE(array_ndims(value), 1) = 1
        AND (cardinality(value) = 0 OR array_lower(value, 1) = 1)
        AND value <@ ARRAY['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4']::TEXT[]
        AND cardinality(value) <= 4
        AND NOT EXISTS (SELECT 1 FROM unnest(value) AS grade WHERE grade IS NULL)
        AND cardinality(value) = (SELECT count(DISTINCT grade) FROM unnest(value) AS grade)
$$;

ALTER TABLE users ADD COLUMN grades TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD CONSTRAINT fld_users_grades_check CHECK (fld_valid_grades(grades));
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD CONSTRAINT fld_users_removed_inactive_check CHECK (deleted_at IS NULL OR is_active = FALSE);

DROP TRIGGER fld_users_revoke_sessions ON users;
CREATE TRIGGER fld_users_revoke_sessions AFTER UPDATE ON users
    FOR EACH ROW WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash
        OR OLD.role IS DISTINCT FROM NEW.role OR OLD.is_active IS DISTINCT FROM NEW.is_active
        OR OLD.grades IS DISTINCT FROM NEW.grades OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
    EXECUTE FUNCTION fld_revoke_changed_user_sessions();
