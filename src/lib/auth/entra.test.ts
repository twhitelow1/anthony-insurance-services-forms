import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyIdToken } from "./entra";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000002";
const CONSUMER = "9188040d-6c67-4c5b-b112-36a304b66dad";
const NONCE = "n0nce";

let privateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

async function token(claims: Record<string, unknown>, opts: { tid?: string; iss?: string; aud?: string } = {}) {
  const tid = opts.tid ?? TENANT_A;
  return new SignJWT({ tid, nonce: NONCE, name: "Pat Staff", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? `https://login.microsoftonline.com/${tid}/v2.0`)
    .setAudience(opts.aud ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

const verify = (t: string) => verifyIdToken(t, keys, { clientId: CLIENT_ID, nonce: NONCE });

describe("Microsoft ID token (multi-tenant)", () => {
  it("accepts work accounts from any organisation", async () => {
    await expect(verify(await token({ email: "Pat@AnthonyInsuranceServices.com" }))).resolves.toEqual({
      email: "pat@anthonyinsuranceservices.com",
      name: "Pat Staff",
    });
    await expect(verify(await token({ email: "todd@dublowdigital.com" }, { tid: TENANT_B }))).resolves.toMatchObject({
      email: "todd@dublowdigital.com",
    });
  });

  it("refuses personal Microsoft accounts", async () => {
    await expect(verify(await token({ email: "someone@outlook.com" }, { tid: CONSUMER }))).rejects.toThrow(/Personal/);
  });

  it("refuses a token whose issuer doesn't match its own tenant", async () => {
    const t = await token({ email: "pat@anthonyinsuranceservices.com" }, { tid: TENANT_B, iss: `https://login.microsoftonline.com/${TENANT_A}/v2.0` });
    await expect(verify(t)).rejects.toThrow(/issuer/);
  });

  it("refuses a token for another app, or with the wrong nonce", async () => {
    await expect(verify(await token({ email: "pat@anthonyinsuranceservices.com" }, { aud: "other-app" }))).rejects.toThrow();
    await expect(verify(await token({ email: "pat@anthonyinsuranceservices.com", nonce: "x" }))).rejects.toThrow(/Nonce/);
  });

  it("never trusts preferred_username or an unverified email domain", async () => {
    await expect(verify(await token({ preferred_username: "pat@anthonyinsuranceservices.com" }))).rejects.toThrow(/verified email/);
    await expect(verify(await token({ email: "pat@anthonyinsuranceservices.com", xms_edov: false }))).rejects.toThrow(/not verified/);
    await expect(verify(await token({ email: "pat@anthonyinsuranceservices.com", xms_edov: true }))).resolves.toBeTruthy();
  });
});
