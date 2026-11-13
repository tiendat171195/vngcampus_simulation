CREATE TABLE "activity_days" (
	"day" date NOT NULL,
	"user_hash" text NOT NULL,
	CONSTRAINT "activity_days_day_user_hash_pk" PRIMARY KEY("day","user_hash")
);
--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"dimension" text DEFAULT '' NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_daily_day_metric_dimension_pk" PRIMARY KEY("day","metric","dimension")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid,
	"target_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"context" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_status" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target" ON "reports" USING btree ("target_user_id");