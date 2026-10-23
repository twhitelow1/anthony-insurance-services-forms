import "server-only";
import { SalesforceError, type ObjectDescribe, type SalesforceApi } from "./api";
import { salesforceConfig, type SalesforceConfig } from "./config";

/**
 * Salesforce REST API client: OAuth 2.0 client credentials flow (an External Client App or
 * Connected App with "Enable Client Credentials Flow" and a Run As integration user; see
 * docs/salesforce-setup.md), then plain sObject / query / describe calls.
 *
 * Nothing here logs record data: errors carry Salesforce's error code and message only.
 */
interface Token {
  accessToken: string;
  instanceUrl: string;
  at: number;
}

const TOKEN_TTL_MS = 50 * 60_000; // refreshed early; a 401 also refreshes it once
const DESCRIBE_TTL_MS = 10 * 60_000;

export function createSalesforceClient(cfg: SalesforceConfig = salesforceConfig()!): SalesforceApi {
  if (!cfg) throw new SalesforceError("Salesforce isn't configured (SALESFORCE_LOGIN_URL, SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET).", 500);
  let token: Token | null = null;
  let lastUsage: { used: number; max: number } | null = null;
  const describes = new Map<string, { at: number; value: Promise<ObjectDescribe> }>();

  async function getToken(force = false): Promise<Token> {
    if (token && !force && Date.now() - token.at < TOKEN_TTL_MS) return token;
    const res = await fetch(`${cfg.loginUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId, client_secret: cfg.clientSecret }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; instance_url?: string; error?: string; error_description?: string };
    if (!res.ok || !body.access_token || !body.instance_url) {
      throw new SalesforceError(`Salesforce sign-in failed (${res.status}): ${body.error_description ?? body.error ?? "no token returned"}`, res.status, body.error);
    }
    token = { accessToken: body.access_token, instanceUrl: body.instance_url.replace(/\/+$/, ""), at: Date.now() };
    return token;
  }

  async function sf<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
    const t = await getToken();
    const url = path.startsWith("http") ? path : `${t.instanceUrl}${path.startsWith("/services/") ? path : `/services/data/${cfg.apiVersion}${path}`}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${t.accessToken}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
    const limit = res.headers.get("sforce-limit-info")?.match(/api-usage=(\d+)\/(\d+)/);
    if (limit) lastUsage = { used: Number(limit[1]), max: Number(limit[2]) };
    if (res.status === 401 && !retried) {
      await getToken(true);
      return sf<T>(path, init, true);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      // Salesforce returns [{ message, errorCode, fields }] on errors.
      const first = Array.isArray(body) ? (body[0] as { message?: string; errorCode?: string }) : null;
      throw new SalesforceError(
        `Salesforce ${init.method ?? "GET"} ${path.split("?")[0]} failed (${res.status})${first?.errorCode ? `: ${first.errorCode} ${first.message ?? ""}` : ""}`,
        res.status,
        first?.errorCode,
      );
    }
    return body as T;
  }

  const api: SalesforceApi = {
    async queryPage<T extends Record<string, unknown>>(soqlOrNext: string) {
      const path = soqlOrNext.startsWith("/services/") ? soqlOrNext : `/query?q=${encodeURIComponent(soqlOrNext)}`;
      const r = await sf<{ records: T[]; nextRecordsUrl?: string; done: boolean }>(path);
      return { records: r.records ?? [], nextRecordsUrl: r.done ? null : (r.nextRecordsUrl ?? null) };
    },
    async query<T extends Record<string, unknown>>(soql: string, opts: { max?: number } = {}) {
      const out: T[] = [];
      let page = await api.queryPage<T>(soql);
      out.push(...page.records);
      while (page.nextRecordsUrl && (!opts.max || out.length < opts.max)) {
        page = await api.queryPage<T>(page.nextRecordsUrl);
        out.push(...page.records);
      }
      return opts.max ? out.slice(0, opts.max) : out;
    },
    describe(object) {
      const hit = describes.get(object);
      if (hit && Date.now() - hit.at < DESCRIBE_TTL_MS) return hit.value;
      const value = sf<ObjectDescribe>(`/sobjects/${encodeURIComponent(object)}/describe`);
      describes.set(object, { at: Date.now(), value });
      value.catch(() => describes.delete(object));
      return value;
    },
    async create(object, data) {
      const r = await sf<{ id: string; success: boolean }>(`/sobjects/${encodeURIComponent(object)}`, { method: "POST", body: JSON.stringify(data) });
      return { id: r.id };
    },
    async update(object, id, data) {
      await sf(`/sobjects/${encodeURIComponent(object)}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
    },
    async uploadFile({ parentId, title, filename, content }) {
      return api.create("ContentVersion", {
        Title: title,
        PathOnClient: filename,
        VersionData: content.toString("base64"),
        FirstPublishLocationId: parentId,
      });
    },
    async postFeed(parentId, body) {
      return api.create("FeedItem", { ParentId: parentId, Body: body, Type: "TextPost" });
    },
    usage: () => lastUsage,
  };
  return api;
}

let shared: SalesforceApi | null = null;
/** One client per server instance (token and describe caches are shared). Null when not configured. */
export function salesforceClient(): SalesforceApi | null {
  if (!salesforceConfig()) return null;
  shared ??= createSalesforceClient();
  return shared;
}
