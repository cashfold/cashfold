-- 0008: the operations not yet sent are read in device-sequence order on every sync round. The old index found them but left the ordering to
-- a sort on the side (ARCH 8.2: no query sorts a table). This one finds them already in order.
DROP INDEX IF EXISTS op_log_push;
CREATE INDEX op_log_pending ON op_log(fold_id, dev_seq) WHERE state = 0;

-- "Is there anything here worth losing?" (the backup reminder) asks for any account, transaction or transfer without reading the Fold.
CREATE INDEX record_meta_table ON record_meta(table_code, fold_id);
