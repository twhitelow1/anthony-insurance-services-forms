import { afterEach, describe, expect, it, vi } from "vitest";
import { createSalesforceClient } from "./client";
import { SalesforceError } from "./api";
import { salesforceConfigFromEnv } from "./config";

afterEach(() => vi.restoreAllMocks());

const cfg = {
  loginUrl: "https://anthony.my.salesforce.com",
  clientId: "cid",
  clientSecret: "secret",
  apiVersion: "v62.0",
  lightningUrl: "https://dg0000000i7rimaa.lightning.force.com",
};

function fakeSalesforce(handler: (url: URL, init: RequestInit) => Response | undefined) {
  const calls: { url: URL; init: RequestInit }[] = [];
  let tokens = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/services/oauth2/token") {
      tokens++;
      return Response.json({ access_token: `tok${tokens}`, instance_url: "https://anthony.my.salesforce.com" });
    }
    return handler(url, init) ?? new Response("not found", { status: 404 });
  });
  return { calls, tokens: () => tokens };
}

describe("Salesforce REST client", () => {
  it("signs in with the client credentials flow and follows query pages", async () => {
    const sf = fakeSalesforce((url) => {
      if (url.pathname === "/services/data/v62.0/query")
        return Response.json({ records: [{ Id: "001A" }], done: false, nextRecordsUrl: "/services/data/v62.0/query/01gX-2000" });
      if (url.pathname === "/services/data/v62.0/query/01gX-2000")
        return Response.json({ records: [{ Id: "001B" }], done: true }, { headers: { "Sforce-Limit-Info": "api-usage=42/15000" } });
    });
    const api = createSalesforceClient(cfg);
    expect(await api.query("SELECT Id FROM Account")).toEqual([{ Id: "001A" }, { Id: "001B" }]);
    const token = sf.calls[0];
    expect(token.url.href).toBe("https://anthony.my.salesforce.com/services/oauth2/token");
    expect(String(token.init.body)).toContain("grant_type=client_credentials");
    expect(sf.calls[1].init.headers).toMatchObject({ Authorization: "Bearer tok1" });
    expect(api.usage()).toEqual({ used: 42, max: 15000 });
  });

  it("gets a new token once on a 401, and reports Salesforce's error code", async () => {
    let first = true;
    const sf = fakeSalesforce((url, init) => {
      if (url.pathname.endsWith("/sobjects/Account") && init.method === "POST") {
        if (first) {
          first = false;
          return new Response("[]", { status: 401 });
        }
        return Response.json([{ message: "Required fields are missing: [Name]", errorCode: "REQUIRED_FIELD_MISSING" }], { status: 400 });
      }
    });
    const api = createSalesforceClient(cfg);
    const err = await api.create("Account", {}).catch((e) => e);
    expect(err).toBeInstanceOf(SalesforceError);
    expect(err).toMatchObject({ status: 400, errorCode: "REQUIRED_FIELD_MISSING" });
    expect(sf.tokens()).toBe(2);
  });

  it("uploads a file to the record with FirstPublishLocationId", async () => {
    const sf = fakeSalesforce((url) => (url.pathname.endsWith("/sobjects/ContentVersion") ? Response.json({ id: "068X", success: true }) : undefined));
    const api = createSalesforceClient(cfg);
    expect(await api.uploadFile({ parentId: "001A", title: "AIS-1", filename: "a.pdf", content: Buffer.from("%PDF") })).toEqual({ id: "068X" });
    const body = JSON.parse(String(sf.calls.at(-1)!.init.body));
    expect(body).toMatchObject({ FirstPublishLocationId: "001A", PathOnClient: "a.pdf", VersionData: Buffer.from("%PDF").toString("base64") });
  });

  it("reads its Vercel settings, and isn't configured without them", () => {
    expect(salesforceConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      salesforceConfigFromEnv({
        SALESFORCE_LOGIN_URL: "https://test.salesforce.com/",
        SALESFORCE_CLIENT_ID: "x",
        SALESFORCE_CLIENT_SECRET: "y",
        SALESFORCE_API_VERSION: "63.0",
      } as unknown as NodeJS.ProcessEnv),
    ).toMatchObject({ loginUrl: "https://test.salesforce.com", apiVersion: "v63.0" });
  });
});
