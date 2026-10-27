CREATE TABLE "carrier_templates" (
	"form_slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"filename" text NOT NULL,
	"content" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"fields" jsonb NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fill_blanks" boolean DEFAULT false NOT NULL,
	"uploaded_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
