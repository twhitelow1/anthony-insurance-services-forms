import { describe, expect, it } from "vitest";
import { nameKey } from "@/lib/clients/text";
import { companyMatchCounts, filterCompanyMatches, matchCompanies, nameSimilarity, type MatchAccount } from "./company-match";

const acct = (id: string, name: string, extra: Partial<MatchAccount> = {}): MatchAccount => ({
  id,
  name,
  nameKey: nameKey(name),
  phones: [],
  website: null,
  primaryEmail: null,
  sfAccountId: null,
  sfAccountType: null,
  ghlCompanyId: null,
  ...extra,
});
const biz = (id: string, name: string, extra: Record<string, string> = {}) => ({ id, name, ...extra });

describe("matching Lead Alchemist Companies to accounts", () => {
  const accounts = [
    acct("a1", "Bounce Barn, LLC", { sfAccountId: "001A", sfAccountType: "Customer" }),
    acct("a2", "Flip Side Gymnastics", { phones: ["(555) 100-2000"] }),
    acct("a3", "Aerial Arts Studio", { website: "https://www.aerialarts.com" }),
    acct("a4", "Peak Climbing Center", { primaryEmail: "owner@peakclimb.com" }),
    acct("a5", "Linked Elsewhere Gym", { ghlCompanyId: "bOther" }),
    acct("a6", "Already Linked", { ghlCompanyId: "b6" }),
  ];

  it("finds same name, phone, website and email domain as likely, similar names as possible", () => {
    const rows = matchCompanies(
      [
        biz("b1", "Bounce Barn"),
        biz("b2", "FSG", { phone: "+1 555-100-2000" }),
        biz("b3", "AA Studio", { website: "aerialarts.com" }),
        biz("b4", "Peak", { email: "info@peakclimb.com" }),
        biz("b5", "Flip Side Gymnastics Academy"),
        biz("b6", "Already Linked"),
        biz("b7", "Linked Elsewhere Gym"),
        biz("b8", "Nothing Like It"),
      ],
      accounts,
    );
    const by = Object.fromEntries(rows.map((r) => [r.business.id, r]));
    expect(by.b1.suggestions[0]).toMatchObject({ account: { id: "a1" }, confidence: "strong", why: ["same name"] });
    expect(by.b2.suggestions[0]).toMatchObject({ account: { id: "a2" }, why: ["same phone"] });
    expect(by.b3.suggestions[0]).toMatchObject({ account: { id: "a3" }, why: ["same website"] });
    expect(by.b4.suggestions[0]).toMatchObject({ account: { id: "a4" }, why: ["same email domain"] });
    expect(by.b5.suggestions[0]).toMatchObject({ account: { id: "a2" }, confidence: "possible" });
    expect(by.b6.linked?.id).toBe("a6");
    expect(by.b7.suggestions).toHaveLength(0); // that account belongs to another Company
    expect(by.b8.suggestions).toHaveLength(0);

    expect(companyMatchCounts(rows)).toEqual({ total: 8, linked: 1, strong: 4, possible: 1, none: 2 });
    expect(filterCompanyMatches(rows, "possible").map((r) => r.business.id)).toEqual(["b5"]);
    expect(filterCompanyMatches(rows, "unlinked")).toHaveLength(7);
  });

  it("scores name similarity by shared words", () => {
    expect(nameSimilarity("flip side gymnastics", "flip side gymnastics academy")).toBeCloseTo(0.75);
    expect(nameSimilarity("peak", "bounce barn")).toBe(0);
  });
});

describe("Lead Alchemist Company name", () => {
  it("uses the Salesforce Account's name when linked, else the account's", async () => {
    const { laCompanyName } = await import("@/lib/clients/text");
    expect(laCompanyName({ name: "Jane Doe", sfSnapshot: { name: "Jane Doe Aerial" } })).toBe("Jane Doe Aerial");
    expect(laCompanyName({ name: "Jane Doe", sfSnapshot: null })).toBe("Jane Doe");
  });
});
