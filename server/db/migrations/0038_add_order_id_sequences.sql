-- Add PostgreSQL sequences for client/supplier order ids. Replaces the previous
-- SELECT-MAX-then-INSERT pattern, which had a TOCTOU race that could yield duplicate ids
-- under concurrent inserts. nextval() is atomic and contention-free.
--
-- We seed each sequence past the historical maximum so newly generated ids cannot collide
-- with the existing legacy `<PREFIX>-YYYY-NNNN` rows.

CREATE SEQUENCE IF NOT EXISTS order_id_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;
--> statement-breakpoint

CREATE SEQUENCE IF NOT EXISTS supplier_order_id_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;
--> statement-breakpoint

-- Seed `order_id_seq` past the largest existing `sales.id` suffix (format `ORD-YYYY-NNNN`).
DO $$
DECLARE
    max_seq BIGINT;
BEGIN
    SELECT COALESCE(MAX(CAST(split_part(id, '-', 3) AS BIGINT)), 0)
      INTO max_seq
      FROM sales
     WHERE id ~ '^ORD-[0-9]{4}-[0-9]+$';
    IF max_seq > 0 THEN
        PERFORM setval('order_id_seq', max_seq);
    END IF;
END $$;
--> statement-breakpoint

-- Seed `supplier_order_id_seq` past the largest existing `supplier_sales.id` suffix.
DO $$
DECLARE
    max_seq BIGINT;
BEGIN
    SELECT COALESCE(MAX(CAST(split_part(id, '-', 3) AS BIGINT)), 0)
      INTO max_seq
      FROM supplier_sales
     WHERE id ~ '^SORD-[0-9]{4}-[0-9]+$';
    IF max_seq > 0 THEN
        PERFORM setval('supplier_order_id_seq', max_seq);
    END IF;
END $$;
