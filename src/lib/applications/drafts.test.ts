import { describe, expect, it } from "vitest";
import { sportsFacilityApplication as form } from "@/forms/sports-facility-application";
import { createApplication } from "./repo";
import { decodeRef, encodeRef, getDraft, listUnfinished, markDraftSubmitted, resumeUrl, saveDraft } from "./drafts";

const email = () => `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

describe("saved progress (drafts)", () => {
  it("creates a draft, keeps updating it with the same ref, and never stores the signature", async () => {
    const first = await saveDraft(form, { values: { first_name: "Pat", signature: "data:image/png;base64,xyz" }, step: 0 });
    expect(first).toBeTruthy();
    expect(first!.emailChanged).toBe(false); // no email yet
    expect(first!.draft.values.signature).toBeUndefined();

    const addr = email();
    const second = await saveDraft(form, { ref: first!.ref, values: { first_name: "Pat", email: addr }, step: 1 });
    expect(second!.ref).toEqual(first!.ref);
    expect(second!.emailChanged).toBe(true);
    expect(second!.draft).toMatchObject({ email: addr, name: "Pat", step: 1, status: "started" });

    const again = await saveDraft(form, { ref: first!.ref, values: { first_name: "Pat", email: addr, phone: "1" }, step: 2 });
    expect(again!.emailChanged).toBe(false); // same email: Lead Alchemist isn't told twice
    expect((await listUnfinished()).some((d) => d.id === first!.ref.id)).toBe(true);
  });

  it("only opens with the right token, and resume links round-trip", async () => {
    const saved = (await saveDraft(form, { values: { email: email() }, step: 0 }))!;
    expect(await getDraft(saved.ref)).toBeTruthy();
    expect(await getDraft({ id: saved.ref.id, token: "x".repeat(32) })).toBeUndefined();
    expect(decodeRef(encodeRef(saved.ref))).toEqual(saved.ref);
    expect(decodeRef("nonsense")).toBeNull();
    expect(resumeUrl(form.slug, saved.ref)).toContain(`/forms/${form.slug}?resume=`);
    // A wrong token starts a fresh draft instead of overwriting someone else's.
    const other = (await saveDraft(form, { ref: { id: saved.ref.id, token: "y".repeat(32) }, values: {}, step: 0 }))!;
    expect(other.ref.id).not.toBe(saved.ref.id);
  });

  it("stops counting as unfinished once submitted, and can't be changed after", async () => {
    const addr = email();
    const saved = (await saveDraft(form, { values: { email: addr }, step: 0 }))!;
    const app = await createApplication(form, { email: addr, first_name: "Pat" }, {});
    expect((await markDraftSubmitted(saved.ref, app.id))?.status).toBe("submitted");
    expect((await listUnfinished()).some((d) => d.id === saved.ref.id)).toBe(false);
    expect(await saveDraft(form, { ref: saved.ref, values: { email: addr }, step: 1 })).toBeNull();
  });
});
