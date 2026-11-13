CREATE TABLE "leaderboard_snapshots" (
	"board" text NOT NULL,
	"period" text NOT NULL,
	"rank" integer NOT NULL,
	"subject_id" text NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_snapshots_board_period_rank_pk" PRIMARY KEY("board","period","rank")
);
--> statement-breakpoint
CREATE TABLE "mission_stats" (
	"mission_id" uuid PRIMARY KEY NOT NULL,
	"participants" integer NOT NULL,
	"completions" integer NOT NULL,
	"median_duration_ms" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_stats" ADD CONSTRAINT "mission_stats_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_ledger_recent" ON "wallet_ledger" USING btree ("currency","created_at");