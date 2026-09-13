-- Existing editor history is unknown. Do not infer an editor from upload ownership.
ALTER TABLE materials
    ADD COLUMN last_edited_at TIMESTAMPTZ,
    ADD COLUMN edit_history_status TEXT NOT NULL DEFAULT 'unknown';

DO $$ DECLARE user_id_type TEXT;
BEGIN
    SELECT format_type(atttypid,atttypmod) INTO user_id_type FROM pg_attribute
        WHERE attrelid='users'::regclass AND attname='id' AND NOT attisdropped;
    IF user_id_type IS NULL THEN RAISE EXCEPTION 'users.id is required'; END IF;
    EXECUTE format('ALTER TABLE materials ADD COLUMN last_edited_by %s REFERENCES users(id) ON DELETE SET NULL',user_id_type);
END $$;

ALTER TABLE materials
    ADD CONSTRAINT materials_edit_history_check CHECK (
        (edit_history_status IN ('unknown','not_edited') AND last_edited_by IS NULL AND last_edited_at IS NULL)
        OR (edit_history_status='edited' AND last_edited_at IS NOT NULL)),
    ALTER COLUMN edit_history_status SET DEFAULT 'not_edited';
