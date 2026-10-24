import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { FIELD_LABELS, loadMergeRecords, MERGE_FIELDS, parseMergeKeys, type MergeRecord, type MergeSystem } from "@/lib/accounts/merge";
import { requireStaff } from "@/lib/auth/session";
import { readFlash } from "@/lib/flash";
import { ghlConfig } from "@/lib/ghl/client";
import { links } from "@/lib/integrations/links";
import { salesforceClient } from "@/lib/salesforce/client";
import { FlashMessage } from "../../salesforce/ui";
import { mergeAction, notDuplicateAction } from "./actions";

export const metadata = { title: "Compare & merge | AIS Connect" };
export const dynamic = "force-dynamic";

const SYSTEM: Record<MergeSystem, string> = { app: "AIS Connect account", sf: "Salesforce Account", la: "Lead Alchemist Company" };

/** Side by side: pick, per system, the record that stays and, per field, the value that stays. */
export default async function MergePage({ searchParams }: PageProps<"/admin/clients/merge">) {
  await requireStaff("/admin/clients");
  const sp = await searchParams;
  const keys = parseMergeKeys(String(sp.keys ?? "").split(","));
  const backTo = typeof sp.back === "string" && sp.back.startsWith("/admin/clients") && !sp.back.includes("//") ? sp.back : "/admin/clients?view=all";
  const [flash, l, sf, laOn] = await Promise.all([readFlash(sp.f), links(), salesforceClient(), ghlConfig()]);
  const records = await loadMergeRecords(keys, { sf, laConnected: !!laOn });
  const of = (s: MergeSystem) => records.filter((r) => r.system === s);
  const href = (r: MergeRecord) => (r.system === "app" ? `/admin/clients/${r.id}` : r.system === "sf" ? l.salesforce("Account", r.id) : l.ghlCompany(r.id));
  // Default values: the AIS Connect account's, else the first record that has one.
  const ordered = [...of("app"), ...of("sf"), ...of("la")];
  const defaultFor = (f: (typeof MERGE_FIELDS)[number]) => ordered.find((r) => r.values[f])?.values[f] ?? "";

  return (
    <div>
      <p className="mb-2 text-sm">
        <Link className="btn-link" href={backTo}>← Back to Accounts</Link>
      </p>
      <h1 className="mb-2 text-2xl font-semibold">Compare &amp; merge</h1>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Pick the record that stays in each system and the details that stay. AIS Connect accounts become one (contacts, applications and history
        move to the one that stays). Another Salesforce Account is hidden here but stays in Salesforce, so merge it there to combine its history.
        Another Lead Alchemist Company has its contacts moved to the one that stays, then is hidden here. Nothing is deleted anywhere.
      </p>
      <FlashMessage flash={flash} />
      {records.length < 2 ? (
        <p className="card !p-4 text-sm">Choose at least two records that are the same business (tick them on Accounts → Across all three).</p>
      ) : (
        <form action={mergeAction} className="space-y-4">
          <input type="hidden" name="keys" value={keys.join(",")} />
          <input type="hidden" name="back" value={backTo} />
          {(["app", "sf", "la"] as MergeSystem[])
            .filter((s) => of(s).length === 1)
            .map((s) => (
              <input key={`keep-${s}`} type="hidden" name={s === "app" ? "keepApp" : s === "sf" ? "keepSf" : "keepLa"} value={of(s)[0].id} />
            ))}
          <div className="card overflow-x-auto !p-0">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th />
                  {ordered.map((r) => (
                    <th key={r.key} className="min-w-[12rem] align-top normal-case">
                      <div className="text-xs uppercase text-[var(--muted)]">{SYSTEM[r.system]}</div>
                      <a className="btn-link font-semibold" href={href(r) ?? "#"} target="_blank" rel="noopener">{r.name}</a>
                      <div className="text-xs font-normal text-[var(--muted)]">{r.detail}</div>
                      {r.linkedTo && <div className="text-xs font-normal text-[var(--muted)]">Linked to &quot;{r.linkedTo}&quot;</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["app", "sf", "la"] as MergeSystem[]).map((s) =>
                  of(s).length > 1 ? (
                    <tr key={`keep-${s}`} className="bg-[var(--accent-soft)]">
                      <td className="font-semibold">Keep this {SYSTEM[s]}</td>
                      {ordered.map((r) => (
                        <td key={r.key}>
                          {r.system === s && (
                            <label className="flex items-center gap-2">
                              <input type="radio" name={s === "app" ? "keepApp" : s === "sf" ? "keepSf" : "keepLa"} value={r.id} defaultChecked={r === of(s).find((x) => x.linkedTo) || (!of(s).some((x) => x.linkedTo) && r === of(s)[0])} required />
                              Stays
                            </label>
                          )}
                        </td>
                      ))}
                    </tr>
                  ) : null,
                )}
                {MERGE_FIELDS.map((f) => {
                  const options = [...new Set(ordered.map((r) => r.values[f]).filter((v): v is string => !!v))];
                  if (!options.length) return null;
                  const def = defaultFor(f);
                  return (
                    <tr key={f}>
                      <td className="font-medium">{FIELD_LABELS[f]}</td>
                      {ordered.map((r) => {
                        const v = r.values[f];
                        const first = v && ordered.find((x) => x.values[f] === v) === r;
                        return (
                          <td key={r.key}>
                            {v ? (
                              first ? (
                                <label className="flex items-start gap-2">
                                  <input type="radio" name={`field_${f}`} value={v} defaultChecked={v === def} className="mt-1" />
                                  <span>{v}</span>
                                </label>
                              ) : (
                                <span className="text-[var(--muted)]" title="Same as another record">{v} (same)</span>
                              )
                            ) : (
                              <span className="text-[var(--muted)]">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {of("sf").length > 0 && (
              <label className="flex items-center gap-2">
                <input type="checkbox" name="writeSf" value="yes" disabled={!sf} /> Also write the chosen details to the Salesforce Account that stays
              </label>
            )}
            {of("la").length > 0 && (
              <label className="flex items-center gap-2">
                <input type="checkbox" name="writeLa" value="yes" disabled={!laOn} /> Also write them to the Lead Alchemist Company that stays
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton className="btn-primary">Merge into one</SubmitButton>
            <button formAction={notDuplicateAction} formNoValidate className="btn-secondary" title="They look alike but are different businesses: stop suggesting them as a match">
              Not the same business
            </button>
            <Link className="btn-link" href={backTo}>Cancel</Link>
          </div>
        </form>
      )}
    </div>
  );
}
