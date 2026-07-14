ALTER TABLE "general_settings" DROP CONSTRAINT "general_settings_ai_provider_check";--> statement-breakpoint
ALTER TABLE "general_settings" ADD COLUMN "ollama_base_url" varchar(2048) DEFAULT 'http://localhost:11434' NOT NULL;--> statement-breakpoint
ALTER TABLE "general_settings" ADD COLUMN "ollama_bearer_token" varchar(2048);--> statement-breakpoint
ALTER TABLE "general_settings" ADD COLUMN "ollama_model_id" varchar(255);--> statement-breakpoint
ALTER TABLE "general_settings" ADD CONSTRAINT "general_settings_ai_provider_check" CHECK ("general_settings"."ai_provider" IN ('gemini', 'openrouter', 'anthropic', 'openai', 'ollama'));