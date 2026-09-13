-- Archive and Materials share one canonical record and the existing links.
ALTER TABLE materials
    ADD COLUMN academic_year TEXT NOT NULL DEFAULT '',
    ADD COLUMN term TEXT NOT NULL DEFAULT '',
    ADD COLUMN area TEXT NOT NULL DEFAULT 'Other',
    ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared',
    ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved',
    ADD COLUMN in_materials BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN content_sha256 TEXT,
    ADD COLUMN normalized_url TEXT;

UPDATE materials SET visibility = CASE WHEN cardinality(grades)=0 THEN 'shared' ELSE 'grades' END,
    normalized_url = CASE WHEN kind='link' THEN url ELSE NULL END;

ALTER TABLE materials
    ADD CONSTRAINT materials_year_check CHECK (academic_year='' OR
        (academic_year ~ '^[0-9]{4}-[0-9]{4}$' AND substring(academic_year,1,4)::integer>=1
            AND substring(academic_year,6,4)::integer=substring(academic_year,1,4)::integer+1)),
    ADD CONSTRAINT materials_term_check CHECK (term IN ('','Full year','Term 1','Term 2','Summer')),
    ADD CONSTRAINT materials_area_check CHECK (area IN ('Teaching & Learning','Planning & Curriculum','School Events','Meetings','Reports','Administration','Other')),
    ADD CONSTRAINT materials_visibility_check CHECK (visibility IN ('shared','grades','management') AND
        ((visibility='grades' AND cardinality(grades)>0) OR (visibility IN ('shared','management') AND cardinality(grades)=0))),
    ADD CONSTRAINT materials_review_check CHECK (review_status IN ('approved','needs_review')),
    ADD CONSTRAINT materials_promotion_check CHECK (NOT in_materials OR (review_status='approved' AND visibility<>'management')),
    ADD CONSTRAINT materials_hash_check CHECK (content_sha256 IS NULL OR (kind='file' AND content_sha256 ~ '^[a-f0-9]{64}$')),
    ADD CONSTRAINT materials_normalized_url_check CHECK (normalized_url IS NULL OR kind='link');

CREATE INDEX materials_archive_listing_idx ON materials (is_archived, academic_year, created_at DESC, id);
CREATE INDEX materials_review_visibility_idx ON materials (review_status, visibility, is_archived);
CREATE INDEX materials_file_hash_idx ON materials (content_sha256) WHERE content_sha256 IS NOT NULL;
CREATE INDEX materials_url_hash_idx ON materials (md5(normalized_url)) WHERE normalized_url IS NOT NULL;
