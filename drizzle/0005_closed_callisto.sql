CREATE TYPE "public"."log_type" AS ENUM('HTTP', 'RPC');--> statement-breakpoint
CREATE TABLE "request_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_name" varchar(50) NOT NULL,
	"type" "log_type" NOT NULL,
	"method" varchar(10),
	"path" text NOT NULL,
	"status_code" integer,
	"duration_ms" integer NOT NULL,
	"correlation_id" varchar(100) NOT NULL,
	"trace_id" varchar(100) NOT NULL,
	"parent_trace_id" varchar(100),
	"user_id" uuid,
	"ip" varchar(64),
	"request_body" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "request_logs_correlation_id_idx" ON "request_logs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "request_logs_service_name_created_at_idx" ON "request_logs" USING btree ("service_name","created_at");