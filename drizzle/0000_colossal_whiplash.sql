CREATE TYPE "public"."attempt_status" AS ENUM('success', 'error', 'timeout', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('openai_compatible', 'anthropic', 'ollama', 'mock');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('success', 'error', 'timeout', 'cancelled');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_hint" varchar(16) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"cooldown_until" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"rate_limit_rpm" integer DEFAULT 60 NOT NULL,
	"monthly_budget_micros" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alias" text NOT NULL,
	"model_id" uuid NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"upstream_model" text NOT NULL,
	"display_name" text NOT NULL,
	"input_price_micros_per_1m" bigint DEFAULT 0 NOT NULL,
	"output_price_micros_per_1m" bigint DEFAULT 0 NOT NULL,
	"context_window" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "provider_type" NOT NULL,
	"base_url" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"timeout_ms" integer DEFAULT 60000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_log_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"provider_id" uuid,
	"api_key_id" uuid,
	"status" "attempt_status" NOT NULL,
	"http_status" integer,
	"error_code" text,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"client_id" uuid,
	"requested_model" text NOT NULL,
	"actual_model" text,
	"provider_id" uuid,
	"api_key_id" uuid,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"ttft_ms" integer,
	"status" "request_status" NOT NULL,
	"error_code" text,
	"is_stream" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attempts" ADD CONSTRAINT "request_attempts_request_log_id_request_logs_id_fk" FOREIGN KEY ("request_log_id") REFERENCES "public"."request_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attempts" ADD CONSTRAINT "request_attempts_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attempts" ADD CONSTRAINT "request_attempts_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_provider_fingerprint_uq" ON "api_keys" USING btree ("provider_id","fingerprint");--> statement-breakpoint
CREATE INDEX "api_keys_provider_active_idx" ON "api_keys" USING btree ("provider_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_key_hash_uq" ON "clients" USING btree ("key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "model_routes_alias_model_uq" ON "model_routes" USING btree ("alias","model_id");--> statement-breakpoint
CREATE INDEX "model_routes_alias_priority_idx" ON "model_routes" USING btree ("alias","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "models_provider_upstream_uq" ON "models" USING btree ("provider_id","upstream_model");--> statement-breakpoint
CREATE INDEX "models_provider_idx" ON "models" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_name_uq" ON "providers" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "request_attempts_log_attempt_uq" ON "request_attempts" USING btree ("request_log_id","attempt_no");--> statement-breakpoint
CREATE INDEX "request_attempts_log_idx" ON "request_attempts" USING btree ("request_log_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_logs_request_id_uq" ON "request_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_logs_created_at_idx" ON "request_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "request_logs_client_created_idx" ON "request_logs" USING btree ("client_id","created_at");