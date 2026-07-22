/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page, { config } from "../page";

const mockPrompt = jest.fn();
jest.mock("@medusajs/ui", () => {
  const actual = jest.requireActual("@medusajs/ui");
  return { ...actual, usePrompt: () => mockPrompt };
});

const fetchMock = jest.fn();

const categories = {
  accountId: "seller-123",
  categories: [
    {
      id: "cat-reverse-holos",
      externalId: "10",
      name: "Reverse Holos",
      parentExternalId: null,
      siblingOrder: 10,
      level: 1,
      path: "Reverse Holos",
      status: "ACTIVE" as const,
    },
    {
      id: "cat-other",
      externalId: "20",
      name: "Other Pokémon Cards",
      parentExternalId: null,
      siblingOrder: 20,
      level: 1,
      path: "Other Pokémon Cards",
      status: "ACTIVE" as const,
    },
  ],
};
const rules = {
  rules: [
    {
      id: "rule-1",
      name: "Reverse Holos",
      enabled: true,
      priority: 10,
      targetStoreCategoryId: "cat-reverse-holos",
      conditions: [{ field: "FINISH", values: ["REVERSE_HOLO"] }],
      updatedAt: "2026-07-21T12:00:00.000Z",
    },
    {
      id: "rule-2",
      name: "Everything else",
      enabled: true,
      priority: 20,
      targetStoreCategoryId: "cat-other",
      conditions: [{ field: "LANGUAGE", values: ["EN"] }],
      updatedAt: "2026-07-21T12:00:00.000Z",
    },
  ],
};
const cardSets = {
  sets: [
    { id: "tcset_1", game: "POKEMON", language: "EN", displayName: "Scarlet & Violet", providerSetCode: "SV01" },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

async function selectCategory(user: ReturnType<typeof userEvent.setup>, label: string, text: string) {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  await user.type(field, text);
  await user.tab();
}

describe("eBay category assignment rules settings page", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    mockPrompt.mockReset().mockResolvedValue(true);
    global.fetch = fetchMock;
    fetchMock.mockImplementation((url: string) =>
      response(
        url.includes("/category-rules")
          ? rules
          : url.includes("/category-fallback")
            ? { fallbackStoreCategoryId: null }
            : url.includes("/trading-cards/sets")
              ? cardSets
              : categories,
      ),
    );
  });

  it("registers the route and lists rules top to bottom by priority", async () => {
    expect(config).toEqual(expect.objectContaining({ label: "eBay category rules" }));
    renderPage();
    expect(await screen.findByText("Everything else")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1); // drop header row
    expect(rows[0]).toHaveTextContent("Reverse Holos");
    expect(rows[1]).toHaveTextContent("Everything else");
  });

  it("offers a pill picker with the canonical values for Finish, not free text", async () => {
    renderPage();
    await screen.findByText("Everything else");
    expect(screen.getByRole("button", { name: "Reverse Holo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Normal" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/comma-separate/i)).not.toBeInTheDocument();
  });

  it("offers pills for Set code sourced from imported card sets, not free text", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Everything else");
    await user.selectOptions(screen.getByLabelText("When the card's"), "SET_CODE");
    expect(await screen.findByRole("button", { name: /SV01/ })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/comma-separate/i)).not.toBeInTheDocument();
  });

  it("falls back to free text for a condition field with no known values (Rarity has fixed pills, so this uses an edge case message instead)", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) =>
      response(
        url.includes("/category-rules")
          ? rules
          : url.includes("/category-fallback")
            ? { fallbackStoreCategoryId: null }
            : url.includes("/trading-cards/sets")
              ? { sets: [] }
              : categories,
      ),
    );
    renderPage();
    await screen.findByText("Everything else");
    await user.selectOptions(screen.getByLabelText("When the card's"), "SET_CODE");
    expect(await screen.findByText(/import some inventory via pulse first/i)).toBeInTheDocument();
  });

  it("adds a new rule using a selected pill value and a searched category, defaulting priority to run last", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Everything else");
    await user.type(screen.getByLabelText("Name"), "Japanese Cards");
    await selectCategory(user, "Put matching cards in", "Other Pokémon Cards");
    await user.selectOptions(screen.getByLabelText("When the card's"), "LANGUAGE");
    await user.click(screen.getByRole("button", { name: "Japanese" }));
    await user.click(screen.getByRole("button", { name: "Add rule" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url) === "/admin/ebay/category-rules")).toBe(true),
    );
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === "/admin/ebay/category-rules" && init?.method !== "GET" && init?.body,
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      environment: "SANDBOX",
      name: "Japanese Cards",
      enabled: true,
      priority: 30,
      targetStoreCategoryId: "cat-other",
      conditions: [{ field: "LANGUAGE", values: ["JA"] }],
    });
  });

  it("reorders rules with the up/down buttons instead of typing a priority number", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Everything else");
    await user.click(screen.getByRole("button", { name: /move "everything else" earlier/i }));
    await waitFor(() => {
      const bodies = fetchMock.mock.calls
        .filter(([url]) => String(url) === "/admin/ebay/category-rules/rule-1" || String(url) === "/admin/ebay/category-rules/rule-2")
        .map(([, init]) => JSON.parse(String(init?.body ?? "{}")));
      expect(bodies.some((b) => b.priority === 20 && b.name === "Reverse Holos")).toBe(true);
      expect(bodies.some((b) => b.priority === 10 && b.name === "Everything else")).toBe(true);
    });
  });

  it("removes a rule after confirmation", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Everything else");
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    await user.click(removeButtons[0]);
    await waitFor(() =>
      expect(mockPrompt).toHaveBeenCalledWith(expect.objectContaining({ title: "Remove this rule?" })),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === "/admin/ebay/category-rules/rule-1/remove"),
      ).toBe(true),
    );
  });

  it("saves the fallback category chosen via the searchable, tree-ordered picker", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Everything else");
    await selectCategory(user, "Fallback category", "Other Pokémon Cards");
    await user.click(screen.getByRole("button", { name: "Save fallback" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/admin/ebay/category-fallback" && init?.body)).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([url, init]) => String(url) === "/admin/ebay/category-fallback" && init?.body);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      environment: "SANDBOX",
      fallbackStoreCategoryId: "cat-other",
    });
  });
});
