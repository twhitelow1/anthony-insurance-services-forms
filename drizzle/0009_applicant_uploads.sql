CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_slug" text NOT NULL,
	"field_id" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"content" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
