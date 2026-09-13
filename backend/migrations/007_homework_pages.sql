ALTER TABLE homework_assignments ADD COLUMN pages TEXT NOT NULL DEFAULT '' CHECK (length(pages) <= 120);
