/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "@medusajs/ui";
import Page, { config } from "../page";

const mockPrompt = jest.fn();
jest.mock("@medusajs/ui", () => {
  const actual = jest.requireActual("@medusajs/ui");
  return { ...actual, usePrompt: () => mockPrompt };
});

const fetchMock = jest.fn();

const catalogue = {
  accountId: "seller-123",
  categories: [
    {
      id: "category-root",
      externalId: "24393782015",
      name: "Black Star Promo Cards",
      parentExternalId: null,
      siblingOrder: 10,
      level: 1,
      path: "Black Star Promo Cards",
      status: "ACTIVE" as const,
      source: "MANUAL",
      updatedAt: "2026-07-20T12:00:00.000Z",
    },
    {
      id: "category-child",
      externalId: "24393788015",
      name: "Mega Evolution Promos",
      parentExternalId: "24393782015",
      siblingOrder: 10,
      level: 2,
      path: "Black Star Promo Cards > Mega Evolution Promos",
      status: "REMOVED" as const,
      source: "CSV",
      updatedAt: "2026-07-20T12:01:00.000Z",
    },
  ],
};
const auditHistory = {
  accountId: "seller-123",
  audits: [
    {
      id: "audit-1",
      action: "MANUAL_EDITED",
      categoryId: "category-root",
      actorId: "admin-user",
      correlationId: "correlation-1",
      details: {
        before: { name: "Old name" },
        after: { name: "Black Star Promo Cards" },
      },
      createdAt: "2026-07-20T12:02:00.000Z",
    },
  ],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

describe("eBay Store categories settings page", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    mockPrompt.mockReset().mockResolvedValue(true);
    global.fetch = fetchMock;
    fetchMock.mockImplementation((url: string) =>
      response(
        url.includes("/audit")
          ? auditHistory
          : url.includes("/preview")
            ? {
                preview: {
                  previewId: "preview-123",
                  valid: true,
                  added: ["a"],
                  changed: ["b"],
                  unchanged: ["c"],
                  invalid: [],
                  removed: ["d"],
                  counts: {
                    added: 1,
                    changed: 1,
                    unchanged: 1,
                    invalid: 0,
                    removed: 1,
                  },
                  truncated: false,
                },
              }
            : catalogue,
      ),
    );
  });

  it("registers the settings route and renders local hierarchy data exactly", async () => {
    expect(config).toEqual(
      expect.objectContaining({ label: "eBay Store categories" }),
    );
    renderPage();
    expect(await screen.findByText("24393782015")).toHaveTextContent(
      "24393782015",
    );
    expect(
      screen.getByText("Black Star Promo Cards > Mega Evolution Promos"),
    ).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("REMOVED")).toBeInTheDocument();
    expect(screen.getByText("REMOVED").closest("tr")).toHaveClass(
      "text-ui-fg-muted",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /does not create, alter or remove categories on eBay/i,
    );
    expect(
      fetchMock.mock.calls.every(([url]) =>
        String(url).startsWith("/admin/ebay/store-categories"),
      ),
    ).toBe(true);
    expect(screen.getByText("Audit history")).toBeInTheDocument();
    expect(screen.getByText("MANUAL_EDITED")).toBeInTheDocument();
    expect(screen.getByText(/admin-user/)).toBeInTheDocument();
    expect(screen.getByText(/Old name/)).toBeInTheDocument();
  });

  it("uses a FocusModal to create and a Drawer to edit local categories", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("24393782015");
    await user.click(
      screen.getByRole("button", { name: "Add local category" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Add local Store category" }),
    ).toHaveAccessibleDescription(
      /add a category to this seller account's local catalogue.*does not create or change a category on eBay/i,
    );
    expect(
      screen.getByLabelText("Exact Store category ID"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Category name")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Parent Store category ID"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Sibling order")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("dialog", { name: "Edit local Store category" }),
    ).toHaveAccessibleDescription(
      /update this category and its position in the local catalogue.*does not change the category on eBay/i,
    );
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("requires a bounded removal reason before opening the confirmation", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("24393782015");
    await user.click(screen.getByRole("button", { name: "Remove locally" }));
    expect(
      screen.getByRole("dialog", { name: "Remove local Store category" }),
    ).toHaveAccessibleDescription(
      /remove this category and its active descendants from the local catalogue.*does not remove anything from eBay/i,
    );
    expect(
      screen.getByText("A removal reason is required."),
    ).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Remove locally" });
    expect(remove).toBeDisabled();
    await user.type(
      screen.getByLabelText("Removal reason"),
      "Duplicated in source",
    );
    expect(screen.getByLabelText("Removal reason")).toHaveAccessibleDescription(
      "A removal reason is required.",
    );
    expect(remove).toBeEnabled();
    await user.click(remove);
    await waitFor(() =>
      expect(mockPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Remove local category?" }),
      ),
    );
  });

  it("emits no Radix missing-description warning while opening category dialogs", async () => {
    const user = userEvent.setup();
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      renderPage();
      await screen.findByText("24393782015");
      await user.click(
        screen.getByRole("button", { name: "Add local category" }),
      );
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "Edit" }));
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "Remove locally" }));
      await waitFor(() => {
        const output = [...warn.mock.calls, ...error.mock.calls]
          .flat()
          .join(" ");
        expect(output).not.toMatch(
          /missing `Description`|aria-describedby=\{undefined\}/i,
        );
      });
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("displays all CSV preview result counts and validation errors", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) =>
      response(
        url.includes("/audit")
          ? auditHistory
          : url.includes("/preview")
            ? {
                preview: {
                  previewId: "preview-invalid",
                  valid: false,
                  added: ["a"],
                  changed: ["b"],
                  unchanged: ["c"],
                  invalid: ["Row 2 has an invalid order"],
                  removed: ["d"],
                  counts: {
                    added: 1,
                    changed: 1,
                    unchanged: 1,
                    invalid: 1,
                    removed: 1,
                  },
                  truncated: false,
                },
              }
            : catalogue,
      ),
    );
    renderPage();
    await screen.findByText("24393782015");
    await user.type(
      screen.getByLabelText("Store category CSV"),
      "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order",
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText(/Added: 1/)).toHaveTextContent("Added: 1");
    expect(screen.getByRole("status")).toHaveTextContent(/Changed: 1/);
    expect(screen.getByRole("status")).toHaveTextContent(/Unchanged: 1/);
    expect(screen.getByRole("status")).toHaveTextContent(/Would be removed: 1/);
    expect(
      screen.getByText(/Invalid: 1 \(Row 2 has an invalid order\)/),
    ).toHaveAttribute("role", "alert");
  });

  it("shows the authoritative server count and a truncation notice when an outcome's ID list is bounded", async () => {
    const user = userEvent.setup();
    const boundedIds = Array.from({ length: 500 }, (_, index) => `id-${index}`);
    fetchMock.mockImplementation((url: string) =>
      response(
        url.includes("/audit")
          ? auditHistory
          : url.includes("/preview")
            ? {
                preview: {
                  previewId: "preview-truncated",
                  valid: true,
                  added: boundedIds,
                  changed: [],
                  unchanged: [],
                  invalid: [],
                  removed: [],
                  counts: {
                    added: 612,
                    changed: 0,
                    unchanged: 0,
                    invalid: 0,
                    removed: 0,
                  },
                  truncated: true,
                },
              }
            : catalogue,
      ),
    );
    renderPage();
    await screen.findByText("24393782015");
    await user.type(
      screen.getByLabelText("Store category CSV"),
      "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order",
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText(/Added: 612/)).toHaveTextContent(
      "Added: 612",
    );
    expect(
      screen.getByText(/detailed lists below are truncated/i),
    ).toHaveAttribute("role", "alert");
  });

  it("waits for explicit confirmation before applying a valid CSV preview", async () => {
    const user = userEvent.setup();
    mockPrompt.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderPage();
    await screen.findByText("24393782015");
    await user.type(
      screen.getByLabelText("Store category CSV"),
      "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order",
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText(/Added: 1/)).toHaveTextContent("Added: 1");
    expect(screen.getByRole("status")).toHaveTextContent(/Changed: 1/);
    expect(screen.getByRole("status")).toHaveTextContent(/Unchanged: 1/);
    expect(screen.getByRole("status")).toHaveTextContent(/Would be removed: 1/);
    await user.click(
      screen.getByRole("button", { name: "Confirm and apply import" }),
    );
    await waitFor(() =>
      expect(mockPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Apply local import?",
          description: expect.stringMatching(
            /complete snapshot.*previewed removals.*nothing is sent to eBay/i,
          ),
        }),
      ),
    );
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/import")),
    ).toBe(false);
    await user.click(
      screen.getByRole("button", { name: "Confirm and apply import" }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/import")),
      ).toBe(true),
    );
    const importCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/import"),
    );
    expect(JSON.parse(String(importCall?.[1]?.body))).toEqual({
      previewId: "preview-123",
      csv: "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order",
      confirm: true,
    });
  });

  it("invalidates a preview immediately when CSV or environment changes", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("24393782015");
    const csvInput = screen.getByLabelText("Store category CSV");
    await user.type(
      csvInput,
      "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order",
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(
      await screen.findByRole("button", { name: "Confirm and apply import" }),
    ).toBeInTheDocument();
    await user.type(csvInput, "x");
    expect(
      screen.queryByRole("button", { name: "Confirm and apply import" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(
      await screen.findByRole("button", { name: "Confirm and apply import" }),
    ).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("Environment"),
      "PRODUCTION",
    );
    expect(
      screen.queryByRole("button", { name: "Confirm and apply import" }),
    ).not.toBeInTheDocument();
  });

  it("hides a rejected preview and asks the administrator to preview again", async () => {
    const user = userEvent.setup();
    const toastError = jest.spyOn(toast, "error");
    fetchMock.mockImplementation((url: string) =>
      url.includes("/audit")
        ? response(auditHistory)
        : url.includes("/preview")
          ? response({
              preview: {
                previewId: "stale-preview",
                valid: true,
                added: [],
                changed: [],
                unchanged: [],
                invalid: [],
                removed: [],
                counts: {
                  added: 0,
                  changed: 0,
                  unchanged: 0,
                  invalid: 0,
                  removed: 0,
                },
                truncated: false,
              },
            })
          : url.endsWith("/import")
            ? response({}, false)
            : response(catalogue),
    );
    renderPage();
    await screen.findByText("24393782015");
    await user.type(
      screen.getByLabelText("Store category CSV"),
      "ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order",
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await user.click(
      await screen.findByRole("button", { name: "Confirm and apply import" }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "The preview is no longer valid. Preview again.",
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Confirm and apply import" }),
    ).not.toBeInTheDocument();
    toastError.mockRestore();
  });

  it("shows invalid CSV details and a safe load error without server details", async () => {
    fetchMock.mockImplementationOnce(() =>
      response({ detail: "private database error" }, false),
    );
    renderPage();
    expect(
      await screen.findByText(
        "The local catalogue could not be loaded for this environment.",
      ),
    ).toHaveAttribute("role", "alert");
    expect(
      screen.queryByText(/private database error/i),
    ).not.toBeInTheDocument();
  });
});
