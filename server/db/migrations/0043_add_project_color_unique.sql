DO $$ 
DECLARE
    project_record RECORD;
    normalized_color text;
    candidate text;
    used_colors text[] := ARRAY[]::text[];
    palette text[] := ARRAY[
        '#ef4444',
        '#f59e0b',
        '#10b981',
        '#3b82f6',
        '#6366f1',
        '#8b5cf6',
        '#d946ef',
        '#64748b'
    ];
    palette_color text;
    generated_index integer;
BEGIN
    FOR project_record IN
        SELECT id, color
        FROM projects
        ORDER BY created_at NULLS FIRST, id
    LOOP
        normalized_color := lower(trim(project_record.color));
        IF normalized_color ~ '^#[0-9a-f]{3}$' THEN
            normalized_color :=
                '#' ||
                substr(normalized_color, 2, 1) ||
                substr(normalized_color, 2, 1) ||
                substr(normalized_color, 3, 1) ||
                substr(normalized_color, 3, 1) ||
                substr(normalized_color, 4, 1) ||
                substr(normalized_color, 4, 1);
        END IF;

        candidate := NULL;
        IF normalized_color ~ '^#[0-9a-f]{6}$' AND normalized_color <> ALL(used_colors) THEN
            candidate := normalized_color;
        ELSE
            FOREACH palette_color IN ARRAY palette LOOP
                IF palette_color <> ALL(used_colors) THEN
                    candidate := palette_color;
                    EXIT;
                END IF;
            END LOOP;

            generated_index := 4096;
            WHILE candidate IS NULL LOOP
                candidate := '#' || lpad(to_hex(generated_index), 6, '0');
                generated_index := generated_index + 1;

                IF candidate = ANY(used_colors) THEN
                    candidate := NULL;
                END IF;

                IF generated_index > 16777215 THEN
                    RAISE EXCEPTION 'Unable to allocate unique project colors during migration';
                END IF;
            END LOOP;
        END IF;

        IF candidate <> project_record.color THEN
            UPDATE projects SET color = candidate WHERE id = project_record.id;
        END IF;
        used_colors := array_append(used_colors, candidate);
    END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_color_unique" ON "projects" USING btree ("color");
