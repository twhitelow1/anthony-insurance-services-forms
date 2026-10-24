import { describe, expect, it } from "vitest";
import { laAppUrl, laEnv } from "./env";

describe("Lead Alchemist settings", () => {
  it("prefers LA_ names and still reads the old GHL_ ones", () => {
    expect(laEnv("API_TOKEN", { LA_API_TOKEN: "new", GHL_API_TOKEN: "old" })).toBe("new");
    expect(laEnv("API_TOKEN", { GHL_API_TOKEN: "old" })).toBe("old");
    expect(laEnv("API_TOKEN", {})).toBeUndefined();
  });

  it("links to the white-label address by default", () => {
    expect(laAppUrl({})).toBe("https://app.leadalchemist.io");
    expect(laAppUrl({ LA_APP_URL: "https://crm.example.com/" })).toBe("https://crm.example.com");
  });
});
