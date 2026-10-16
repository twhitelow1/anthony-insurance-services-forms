CREATE TABLE "library_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"content" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"form_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
