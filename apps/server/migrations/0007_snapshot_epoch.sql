-- 0007: the key epoch a snapshot was sealed under. The client needs it to open the snapshot (it is part of what the sealed
-- bytes are bound to), and the relay already receives it with the upload.
ALTER TABLE snapshot ADD COLUMN epoch integer NOT NULL DEFAULT 1;
