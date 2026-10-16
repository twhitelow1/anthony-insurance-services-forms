import { describe, expect, it } from "vitest";
import { addLibraryFile, deleteLibraryFile, getLibraryFile, libraryForForm, libraryUrl, updateLibraryFile } from "./library";

describe("document library", () => {
  it("stores a file, shows it only on the forms it's assigned to, and deletes it", async () => {
    const f = await addLibraryFile({
      title: "Sample Release and Waiver",
      filename: "waiver.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.4 test"),
      formSlugs: ["aerial-yoga-studio-application"],
      updatedBy: "staff:test",
    });
    expect((await getLibraryFile(f.id))?.content.toString()).toBe("%PDF-1.4 test");
    expect((await libraryForForm("aerial-yoga-studio-application")).map((d) => d.id)).toContain(f.id);
    expect((await libraryForForm("camp-clinic-application")).map((d) => d.id)).not.toContain(f.id);
    expect(libraryUrl(f)).toBe(`https://forms.example.com/library/${f.id}`);

    await updateLibraryFile(f.id, { formSlugs: ["camp-clinic-application"], updatedBy: "staff:test" });
    expect((await libraryForForm("camp-clinic-application")).map((d) => d.id)).toContain(f.id);
    expect((await libraryForForm("aerial-yoga-studio-application")).map((d) => d.id)).not.toContain(f.id);

    await deleteLibraryFile(f.id);
    expect(await getLibraryFile(f.id)).toBeUndefined();
    expect(await getLibraryFile("not-a-uuid")).toBeUndefined();
  });
});
