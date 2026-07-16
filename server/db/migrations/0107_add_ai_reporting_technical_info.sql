ALTER TABLE "report_chat_messages" ADD COLUMN "ai_provider" varchar(20);--> statement-breakpoint
ALTER TABLE "report_chat_messages" ADD COLUMN "ai_model_id" varchar(255);--> statement-breakpoint
ALTER TABLE "report_chat_messages" ADD COLUMN "context_tokens_used" integer;--> statement-breakpoint
ALTER TABLE "report_chat_messages" ADD COLUMN "context_window_tokens" integer;