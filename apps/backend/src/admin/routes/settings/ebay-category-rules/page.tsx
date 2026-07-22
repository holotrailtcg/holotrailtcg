import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchJson, postAction } from "../../../components/imports/fetch-json";
import { SearchableCategorySelect } from "../../../components/ebay/searchable-category-select";
import { CARD_FINISH_LABELS, SPECIAL_TREATMENT_LABELS } from "../../../../modules/trading-cards/types";

type ConditionField =
  | "LANGUAGE"
  | "FINISH"
  | "RARITY"
  | "SPECIAL_TREATMENT"
  | "SET_CODE"
  | "SET_NAME";
type Condition = { field: ConditionField; values: string[] };
type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  targetStoreCategoryId: string;
  conditions: Condition[];
  updatedAt: string;
};
type Category = {
  id: string;
  externalId: string;
  name: string;
  parentExternalId: string | null;
  siblingOrder: number;
  level: number;
  path: string;
  status: "ACTIVE" | "REMOVED";
};
type Catalogue = { accountId: string; categories: Category[] };
type CardSet = { id: string; game: string; language: string; displayName: string; providerSetCode: string };

const FIELD_OPTIONS: { value: ConditionField; label: string }[] = [
  { value: "LANGUAGE", label: "Language" },
  { value: "FINISH", label: "Finish" },
  { value: "RARITY", label: "Rarity" },
  { value: "SPECIAL_TREATMENT", label: "Special treatment" },
  { value: "SET_CODE", label: "Set code" },
  { value: "SET_NAME", label: "Set name" },
];

// Finish and Special Treatment pull their labels directly from
// modules/trading-cards/types.ts (the same maps that drive the Medusa
// "Finish"/"Special Treatment" product options — single source of truth).
// Language and Rarity have no Medusa-option equivalent yet, so they're
// still a local list here. Set code/name have no fixed enum at all — their
// pill options are built at runtime below from sets Holo Trail has actually
// imported (see cardSetsQuery).
const PILL_OPTIONS: Partial<Record<ConditionField, { value: string; label: string }[]>> = {
  LANGUAGE: [
    { value: "EN", label: "English" },
    { value: "JA", label: "Japanese" },
    { value: "ZH", label: "Chinese" },
  ],
  FINISH: Object.entries(CARD_FINISH_LABELS).map(([value, label]) => ({ value, label })),
  RARITY: [
    { value: "COMMON", label: "Common" },
    { value: "UNCOMMON", label: "Uncommon" },
    { value: "NO_RARITY", label: "No rarity" },
    { value: "PROMO", label: "Promo" },
    { value: "DOUBLE_RARE", label: "Double Rare" },
    { value: "ULTRA_RARE", label: "Ultra Rare" },
    { value: "ULTRA_RARE_SINGLE", label: "Ultra Rare (single star)" },
    { value: "SHINY_ULTRA_RARE", label: "Shiny Ultra Rare" },
    { value: "HYPER_RARE", label: "Hyper Rare" },
    { value: "ILLUSTRATION_RARE", label: "Illustration Rare" },
    { value: "BLACK_WHITE_RARE", label: "Black White Rare" },
    { value: "ACE_SPEC", label: "ACE SPEC" },
    { value: "MEGA_ATTACK_RARE", label: "Mega Attack Rare" },
    { value: "MEGA_HYPER_RARE", label: "Mega Hyper Rare" },
  ],
  SPECIAL_TREATMENT: Object.entries(SPECIAL_TREATMENT_LABELS).map(([value, label]) => ({ value, label })),
};

const emptyForm = {
  name: "",
  priority: "",
  targetStoreCategoryId: "",
  conditionField: "FINISH" as ConditionField,
  conditionValues: [] as string[],
  conditionText: "",
};

function ValuePicker({
  field,
  values,
  text,
  onValuesChange,
  onTextChange,
  dynamicOptions,
  dynamicOptionsLoading,
  dynamicOptionsEmptyMessage,
}: {
  field: ConditionField;
  values: string[];
  text: string;
  onValuesChange: (values: string[]) => void;
  onTextChange: (text: string) => void;
  dynamicOptions?: { value: string; label: string }[];
  dynamicOptionsLoading?: boolean;
  dynamicOptionsEmptyMessage?: string;
}) {
  const options = PILL_OPTIONS[field] ?? dynamicOptions;
  if (!options) {
    return (
      <Input
        id="rule-values"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="e.g. SV01, or comma-separate more than one"
      />
    );
  }
  if (dynamicOptionsLoading) {
    return (
      <Text size="small" className="text-ui-fg-subtle">
        Loading…
      </Text>
    );
  }
  if (options.length === 0 && dynamicOptionsEmptyMessage) {
    return (
      <Text size="small" className="text-ui-fg-subtle">
        {dynamicOptionsEmptyMessage}
      </Text>
    );
  }
  const toggle = (value: string) => {
    onValuesChange(
      values.includes(value) ? values.filter((v) => v !== value) : [...values, value],
    );
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => toggle(option.value)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              selected
                ? "border-ui-button-inverted bg-ui-button-inverted text-ui-fg-on-inverted"
                : "border-ui-border-base text-ui-fg-subtle hover:border-ui-border-interactive"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Rules are evaluated in ascending priority order (lowest number first); the
 * first enabled rule whose single condition matches wins. Kept to one
 * condition per rule in this UI for simplicity — the API accepts multiple
 * AND-ed conditions per rule for more advanced setups if ever needed.
 */
const EbayCategoryRulesPage = () => {
  const prompt = usePrompt();
  const client = useQueryClient();
  const [environment, setEnvironment] = useState("SANDBOX");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fallbackId, setFallbackId] = useState("");

  const rulesQuery = useQuery({
    queryKey: ["ebay-category-rules", environment],
    queryFn: () => fetchJson<{ rules: Rule[] }>(`/admin/ebay/category-rules?environment=${environment}`),
    retry: false,
  });
  const categoriesQuery = useQuery({
    queryKey: ["ebay-store-categories", environment],
    queryFn: () => fetchJson<Catalogue>(`/admin/ebay/store-categories?environment=${environment}`),
    retry: false,
  });
  const fallbackQuery = useQuery({
    queryKey: ["ebay-category-fallback", environment],
    queryFn: () => fetchJson<{ fallbackStoreCategoryId: string | null }>(`/admin/ebay/category-fallback?environment=${environment}`),
    retry: false,
  });
  const cardSetsQuery = useQuery({
    queryKey: ["trading-card-sets"],
    queryFn: () => fetchJson<{ sets: CardSet[] }>("/admin/trading-cards/sets"),
    retry: false,
  });

  const activeCategories = (categoriesQuery.data?.categories ?? []).filter((c) => c.status === "ACTIVE");
  const setCodeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const set of cardSetsQuery.data?.sets ?? []) {
      if (!seen.has(set.providerSetCode)) seen.set(set.providerSetCode, `${set.providerSetCode} — ${set.displayName}`);
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cardSetsQuery.data]);
  const setNameOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const set of cardSetsQuery.data?.sets ?? []) seen.add(set.displayName);
    return [...seen].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }));
  }, [cardSetsQuery.data]);
  const orderedRules = useMemo(
    () => [...(rulesQuery.data?.rules ?? [])].sort((a, b) => a.priority - b.priority),
    [rulesQuery.data],
  );
  const nextPriority = useMemo(
    () => (orderedRules.length === 0 ? 10 : Math.max(...orderedRules.map((r) => r.priority)) + 10),
    [orderedRules],
  );

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["ebay-category-rules", environment] });
    setForm({ ...emptyForm, priority: String(nextPriority) });
    setEditingId(null);
  };

  const isPillField = (field: ConditionField) =>
    Boolean(PILL_OPTIONS[field]) || field === "SET_CODE" || field === "SET_NAME";

  const conditionValuesForForm = () =>
    isPillField(form.conditionField)
      ? form.conditionValues
      : form.conditionText.split(",").map((v) => v.trim()).filter(Boolean);

  const save = useMutation({
    mutationFn: () => {
      const values = conditionValuesForForm();
      const body = {
        environment,
        name: form.name,
        enabled: true,
        priority: form.priority.trim() ? Number(form.priority) : nextPriority,
        targetStoreCategoryId: form.targetStoreCategoryId,
        conditions: values.length ? [{ field: form.conditionField, values }] : [],
      };
      return editingId
        ? postAction(`/admin/ebay/category-rules/${editingId}`, body)
        : postAction("/admin/ebay/category-rules", body);
    },
    onSuccess: () => {
      toast.success("Rule saved.");
      refresh();
    },
    onError: () => toast.error("This rule could not be saved. Every rule needs at least one condition value."),
  });

  const updateRule = useMutation({
    mutationFn: (rule: Rule) =>
      postAction(`/admin/ebay/category-rules/${rule.id}`, {
        environment,
        name: rule.name,
        enabled: rule.enabled,
        priority: rule.priority,
        targetStoreCategoryId: rule.targetStoreCategoryId,
        conditions: rule.conditions,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["ebay-category-rules", environment] }),
    onError: () => toast.error("This rule could not be updated."),
  });

  const swapPriority = (rule: Rule, neighbour: Rule) => {
    updateRule.mutate({ ...rule, priority: neighbour.priority });
    updateRule.mutate({ ...neighbour, priority: rule.priority });
  };

  const removeRule = useMutation({
    mutationFn: (id: string) => postAction(`/admin/ebay/category-rules/${id}/remove`, { environment }),
    onSuccess: refresh,
    onError: () => toast.error("This rule could not be removed."),
  });

  const saveFallback = useMutation({
    mutationFn: () => postAction("/admin/ebay/category-fallback", { environment, fallbackStoreCategoryId: fallbackId || null }),
    onSuccess: () => {
      toast.success("Fallback category saved.");
      client.invalidateQueries({ queryKey: ["ebay-category-fallback", environment] });
    },
    onError: () => toast.error("The fallback category could not be saved."),
  });

  const startEdit = (rule: Rule) => {
    setEditingId(rule.id);
    const field = rule.conditions[0]?.field ?? "FINISH";
    const values = rule.conditions[0]?.values ?? [];
    setForm({
      name: rule.name,
      priority: String(rule.priority),
      targetStoreCategoryId: rule.targetStoreCategoryId,
      conditionField: field,
      conditionValues: isPillField(field) ? values : [],
      conditionText: isPillField(field) ? "" : values.join(", "),
    });
  };

  const handleRemove = async (rule: Rule) => {
    const confirmed = await prompt({
      title: "Remove this rule?",
      description: `"${rule.name}" will no longer be evaluated.`,
      confirmText: "Remove",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (confirmed) removeRule.mutate(rule.id);
  };

  const categoryName = (id: string) => activeCategories.find((c) => c.id === id)?.path ?? id;
  const selectClassName = "w-fit rounded-md border border-ui-border-base px-4 py-2.5 text-ui-fg-base";
  const canSave =
    form.name.trim() &&
    form.targetStoreCategoryId &&
    (isPillField(form.conditionField) ? form.conditionValues.length > 0 : form.conditionText.trim());

  return (
    <div className="flex flex-col gap-6">
      <Container className="flex flex-col gap-3 p-6">
        <Heading level="h1">eBay category assignment rules</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          When a new Pulse row comes in for review, these rules suggest which eBay Store category it
          belongs in. Rules are checked top to bottom in the table below — the first enabled rule whose
          condition matches the card wins. If nothing matches, the fallback category is suggested instead;
          if that isn't set either, an Admin has to pick a category by hand.
        </Text>
        <select
          aria-label="Environment"
          className={selectClassName}
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
        >
          <option value="SANDBOX">Sandbox</option>
          <option value="PRODUCTION">Production</option>
        </select>
      </Container>

      <Container className="flex flex-col gap-3 p-6">
        <Heading level="h2">Fallback category</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Used when none of the rules below match a card.
        </Text>
        <SearchableCategorySelect
          id="rule-fallback-category"
          ariaLabel="Fallback category"
          categories={activeCategories}
          value={fallbackId || fallbackQuery.data?.fallbackStoreCategoryId || ""}
          onChange={setFallbackId}
          placeholder="Search categories — or leave blank for none"
        />
        <Button variant="secondary" isLoading={saveFallback.isPending} onClick={() => saveFallback.mutate()}>
          Save fallback
        </Button>
      </Container>

      <Container className="flex flex-col gap-3 p-6">
        <Heading level="h2">{editingId ? "Edit rule" : "New rule"}</Heading>

        <Label htmlFor="rule-name">Name</Label>
        <Text size="small" className="text-ui-fg-subtle">
          A short label to recognise this rule by — it isn't shown to customers.
        </Text>
        <Input id="rule-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />

        <Label htmlFor="rule-target">Put matching cards in</Label>
        <SearchableCategorySelect
          id="rule-target"
          ariaLabel="Put matching cards in"
          categories={activeCategories}
          value={form.targetStoreCategoryId}
          onChange={(categoryId) => setForm({ ...form, targetStoreCategoryId: categoryId })}
          placeholder="Search categories…"
        />

        <Label htmlFor="rule-field">When the card's</Label>
        <select
          id="rule-field"
          className={selectClassName}
          value={form.conditionField}
          onChange={(event) =>
            setForm({ ...form, conditionField: event.target.value as ConditionField, conditionValues: [], conditionText: "" })
          }
        >
          {FIELD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <Label>is one of</Label>
        <ValuePicker
          field={form.conditionField}
          values={form.conditionValues}
          text={form.conditionText}
          onValuesChange={(values) => setForm({ ...form, conditionValues: values })}
          onTextChange={(text) => setForm({ ...form, conditionText: text })}
          dynamicOptions={
            form.conditionField === "SET_CODE" ? setCodeOptions : form.conditionField === "SET_NAME" ? setNameOptions : undefined
          }
          dynamicOptionsLoading={
            (form.conditionField === "SET_CODE" || form.conditionField === "SET_NAME") && cardSetsQuery.isLoading
          }
          dynamicOptionsEmptyMessage="No card sets found yet — import some inventory via Pulse first, or use the fallback category instead."
        />

        <details className="mt-1">
          <summary className="cursor-pointer text-sm text-ui-fg-subtle">Advanced: rule order</summary>
          <div className="mt-2 flex flex-col gap-1">
            <Text size="small" className="text-ui-fg-subtle">
              When more than one rule could match the same card, the rule with the lower number here wins.
              New rules are placed last by default — use the ↑ / ↓ buttons in the table below to reorder
              instead of typing a number, unless you need to slot a rule in a precise position.
            </Text>
            <Input
              id="rule-priority"
              type="number"
              className="w-32"
              placeholder={String(nextPriority)}
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value })}
            />
          </div>
        </details>

        <div className="mt-2 flex gap-3">
          <Button disabled={!canSave} isLoading={save.isPending} onClick={() => save.mutate()}>
            {editingId ? "Save changes" : "Add rule"}
          </Button>
          {editingId && (
            <Button variant="secondary" onClick={refresh}>
              Cancel
            </Button>
          )}
        </div>
      </Container>

      <Container className="p-6">
        <Heading level="h2">Rules</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Checked in this order — top first.
        </Text>
        {rulesQuery.isError && <Text role="alert">Rules could not be loaded.</Text>}
        <table className="w-full text-left">
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th>Puts matches in</th>
              <th>Condition</th>
              <th className="text-center">Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orderedRules.map((rule, index) => (
              <tr key={rule.id}>
                <td>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      aria-label={`Move "${rule.name}" earlier`}
                      disabled={index === 0}
                      onClick={() => swapPriority(rule, orderedRules[index - 1])}
                      className="disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`Move "${rule.name}" later`}
                      disabled={index === orderedRules.length - 1}
                      onClick={() => swapPriority(rule, orderedRules[index + 1])}
                      className="disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>
                </td>
                <td>{rule.name}</td>
                <td>{categoryName(rule.targetStoreCategoryId)}</td>
                <td>
                  {rule.conditions.map((condition, conditionIndex) => (
                    <Badge key={conditionIndex} className="mr-1">
                      {condition.field}: {condition.values.join(", ")}
                    </Badge>
                  ))}
                </td>
                <td className="text-center">
                  <Switch checked={rule.enabled} onCheckedChange={() => updateRule.mutate({ ...rule, enabled: !rule.enabled })} />
                </td>
                <td className="flex gap-2">
                  <Button variant="secondary" size="small" onClick={() => startEdit(rule)}>
                    Edit
                  </Button>
                  <Button variant="danger" size="small" onClick={() => handleRemove(rule)}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Container>
    </div>
  );
};

export const config = defineRouteConfig({ label: "eBay category rules" });
export default EbayCategoryRulesPage;
