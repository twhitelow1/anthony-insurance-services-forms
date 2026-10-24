import { describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ListSummary, pageHref, pageOf, pageState, Pagination } from "./Pagination";

const text = (el: ReactElement) => renderToStaticMarkup(el).replace(/<[^>]+>/g, "");

describe("pagination", () => {
  it("reads page and size, ignoring bad values", () => {
    expect(pageState({ page: "3", size: "100" })).toEqual({ page: 3, pageSize: 100, offset: 200 });
    expect(pageState({ page: "-2", size: "7" })).toEqual({ page: 1, pageSize: 50, offset: 0 });
    expect(pageState({ activityPage: "2" }, 25, "activity")).toEqual({ page: 2, pageSize: 25, offset: 25 });
  });

  it("builds links that keep the other filters and drop defaults", () => {
    const href = pageHref("/admin/mapping", { tab: "accounts", filter: undefined }, 100);
    expect(href(1, 100)).toBe("/admin/mapping?tab=accounts");
    expect(href(4, 50)).toBe("/admin/mapping?tab=accounts&page=4&size=50");
    expect(pageHref("/admin/clients/x", {}, 25, "activity", "activity-heading")(2, 25)).toBe("/admin/clients/x?activityPage=2#activity-heading");
  });

  it("slices in-memory lists", () => {
    expect(pageOf([1, 2, 3, 4, 5], { page: 2, pageSize: 2, offset: 2 })).toEqual([3, 4]);
  });

  it("says where you are in the list", () => {
    const at = (page: number, pageSize = 50) => ({ page, pageSize, offset: (page - 1) * pageSize });
    expect(text(createElement(ListSummary, { total: 1234, state: at(2), noun: "account" }))).toBe("Showing 51–100 of 1,234 accounts");
    expect(text(createElement(ListSummary, { total: 3, state: at(1), noun: "Company" }))).toBe("Showing 1–3 of 3 Companies");
    expect(text(createElement(ListSummary, { total: 0, state: at(1), noun: "person" }))).toBe("No people");
    const nav = text(createElement(Pagination, { total: 1234, state: at(2), noun: "account", href: (p: number) => `?page=${p}` }));
    expect(nav).toContain("Page 2 of 25 · 1,234 accounts");
    expect(nav).toContain("Per page:");
  });
});
