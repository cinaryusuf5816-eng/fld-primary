-- Folders organize canonical material records; moving a file never changes its audience.
CREATE TABLE archive_folders (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120 AND name=btrim(name)),
    parent_id BIGINT REFERENCES archive_folders(id) ON DELETE RESTRICT,
    visibility TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared','grades','management')),
    grades TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT archive_folders_grades_check CHECK (fld_valid_grades(grades) AND
        ((visibility='grades' AND cardinality(grades)>0) OR (visibility IN ('shared','management') AND cardinality(grades)=0))),
    CONSTRAINT archive_folders_parent_check CHECK (parent_id IS NULL OR parent_id<>id)
);
DO $$ DECLARE user_id_type TEXT;
BEGIN
    SELECT format_type(atttypid,atttypmod) INTO user_id_type FROM pg_attribute
        WHERE attrelid='users'::regclass AND attname='id' AND NOT attisdropped;
    IF user_id_type IS NULL THEN RAISE EXCEPTION 'users.id is required'; END IF;
    EXECUTE format('ALTER TABLE archive_folders ADD COLUMN created_by %s REFERENCES users(id) ON DELETE SET NULL', user_id_type);
END $$;
CREATE UNIQUE INDEX archive_folders_sibling_name_idx ON archive_folders (COALESCE(parent_id,0),lower(name));
CREATE INDEX archive_folders_parent_idx ON archive_folders (parent_id,id);

CREATE FUNCTION validate_archive_folder() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent archive_folders%ROWTYPE;
DECLARE levels INTEGER;
BEGIN
    -- A folder's scope and parent stay fixed. Child folders inherit the root audience.
    IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR
        NEW.visibility IS DISTINCT FROM OLD.visibility OR NEW.grades IS DISTINCT FROM OLD.grades) THEN
        RAISE EXCEPTION 'Folder parent and audience cannot be changed' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' AND NEW.parent_id IS NOT NULL THEN
        SELECT * INTO parent FROM archive_folders WHERE id=NEW.parent_id FOR SHARE;
        IF NOT FOUND OR parent.visibility<>NEW.visibility OR parent.grades<>NEW.grades THEN
            RAISE EXCEPTION 'Child folders must inherit their parent audience' USING ERRCODE='23514';
        END IF;
        WITH RECURSIVE ancestors AS (
            SELECT id,parent_id,1 AS depth FROM archive_folders WHERE id=NEW.parent_id
            UNION ALL SELECT f.id,f.parent_id,a.depth+1 FROM archive_folders f JOIN ancestors a ON f.id=a.parent_id WHERE a.depth<9
        ) SELECT max(depth) INTO levels FROM ancestors;
        IF levels>=8 THEN RAISE EXCEPTION 'Folders support at most eight levels' USING ERRCODE='23514'; END IF;
    END IF;
    IF TG_OP='UPDATE' THEN NEW.updated_at=CURRENT_TIMESTAMP; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER archive_folders_validate BEFORE INSERT OR UPDATE ON archive_folders
    FOR EACH ROW EXECUTE FUNCTION validate_archive_folder();

ALTER TABLE materials ADD COLUMN folder_id BIGINT REFERENCES archive_folders(id) ON DELETE RESTRICT;
CREATE INDEX materials_folder_listing_idx ON materials (folder_id,is_archived,created_at DESC,id);

CREATE FUNCTION validate_material_folder() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE folder archive_folders%ROWTYPE;
BEGIN
    IF NEW.folder_id IS NOT NULL THEN
        SELECT * INTO folder FROM archive_folders WHERE id=NEW.folder_id FOR SHARE;
        IF NOT FOUND OR NOT (folder.visibility='shared' OR NEW.visibility='management' OR
            (folder.visibility='grades' AND NEW.visibility='grades' AND NEW.grades <@ folder.grades)) THEN
            RAISE EXCEPTION 'The material audience must fit its folder' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER materials_validate_folder BEFORE INSERT OR UPDATE OF folder_id,visibility,grades ON materials
    FOR EACH ROW EXECUTE FUNCTION validate_material_folder();

ALTER TABLE archive_folders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON archive_folders FROM PUBLIC;
DO $$ DECLARE api_role TEXT;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
            EXECUTE format('REVOKE ALL ON archive_folders FROM %I',api_role);
        END IF;
    END LOOP;
END $$;
