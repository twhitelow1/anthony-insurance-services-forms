import { describe, expect, it } from "vitest";
import { databaseUrl, describeDbError } from "./url";

describe("databaseUrl", () => {
  it("prefers DATABASE_URL, then POSTGRES_URL", () => {
    expect(databaseUrl({ DATABASE_URL: "postgres://a", POSTGRES_URL: "postgres://b" })?.name).toBe("DATABASE_URL");
    expect(databaseUrl({ POSTGRES_URL: "postgres://b" })?.name).toBe("POSTGRES_URL");
  });
  it("finds a prefixed Neon variable, skipping unpooled ones", () => {
    expect(databaseUrl({ NEON_DATABASE_URL_UNPOOLED: "postgres://u", NEON_DATABASE_URL: "postgres://p" })).toEqual({
      name: "NEON_DATABASE_URL",
      url: "postgres://p",
    });
  });
  it("returns null when nothing is set", () => {
    expect(databaseUrl({ OTHER: "x" })).toBeNull();
  });
});

describe("describeDbError", () => {
  it("includes the driver's cause and hides connection strings", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const err = new Error("Failed query: insert into applications\nparams: x", { cause });
    expect(describeDbError(err)).toBe("Failed query: insert into applications — connect ECONNREFUSED 127.0.0.1:5432");
    expect(describeDbError(new Error("bad postgres://user:pw@host/db"))).toBe("bad postgres://…");
  });
});
