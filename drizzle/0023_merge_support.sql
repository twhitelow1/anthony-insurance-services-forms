CREATE TABLE "lead_alchemist_hidden" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"kept_id" text,
	"hidden_by" text NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "not_duplicates" (
	"pair" text PRIMARY KEY NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
