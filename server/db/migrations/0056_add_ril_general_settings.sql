ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS ril_company_name VARCHAR(255) DEFAULT '',
  ADD COLUMN IF NOT EXISTS ril_default_start_time VARCHAR(5) DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS ril_lunch_break_minutes INTEGER DEFAULT 60;

UPDATE general_settings
SET
  ril_company_name = COALESCE(ril_company_name, ''),
  ril_default_start_time = COALESCE(ril_default_start_time, '09:00'),
  ril_lunch_break_minutes = COALESCE(ril_lunch_break_minutes, 60);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'general_settings_ril_default_start_time_check'
  ) THEN
    ALTER TABLE general_settings
      ADD CONSTRAINT general_settings_ril_default_start_time_check
      CHECK (ril_default_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'general_settings_ril_lunch_break_minutes_check'
  ) THEN
    ALTER TABLE general_settings
      ADD CONSTRAINT general_settings_ril_lunch_break_minutes_check
      CHECK (ril_lunch_break_minutes >= 0 AND ril_lunch_break_minutes <= 240);
  END IF;
END $$;
