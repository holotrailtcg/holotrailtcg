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
import { useState } from "react";
import { fetchJson, postAction } from "../../../../components/imports/fetch-json";

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
type Category = { id: string; name: string; path: string; status: "ACTIVE" | "REMOVED" };
type Catalogue = { accountId: string; categories: Category[] };

const FIELD_OPTIONS: { value: ConditionField; label: string }[] = [
  { value: "LANGUAGE", label: "Language" },
  { value: "FINISH", label: "Finish" },
  { value: "RARITY", label: "Rarity" },
  { value: "SPECIAL_TREATMENT", label: "Special treatment" },
  { value: "SET_CODE", label: "Set code" },
  { value: "SET_NAME", label: "Set name" },
];

const emptyForm = {
  name: "",
  priority: "100",
  targetStoreCategoryId: "",
  conditionField: "FINISH" as ConditionField,
  conditionValues: "",
};

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

  const activeCategories = (categoriesQuery.data?.categories ?? []).filter((c) => c.status === "ACTIVE");

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["ebay-category-rules", environment] });
    setForm(emptyForm);
    setEditingId(null);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        environment,
        name: form.name,
        enabled: true,
        priority: Number(form.priority) || 0,
        targetStoreCategoryId: form.targetStoreCategoryId,
        conditions: form.conditionValues.trim()
          ? [{ field: form.conditionField, values: form.conditionValues.split(",").map((v) => v.trim()).filter(Boolean) }]
          : [],
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

  const toggleEnabled = useMutation({
    mutationFn: (rule: Rule) =>
      postAction(`/admin/ebay/category-rules/${rule.id}`, {
        environment,
        name: rule.name,
        enabled: !rule.enabled,
        priority: rule.priority,
        targetStoreCategoryId: rule.targetStoreCategoryId,
        conditions: rule.conditions,
      }),
    onSuccess: refresh,
    onError: () => toast.error("This rule could not be updated."),
  });

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
    setForm({
      name: rule.name,
      priority: String(rule.priority),
      targetStoreCategoryId: rule.targetStoreCategoryId,
      conditionField: rule.conditions[0]?.field ?? "FINISH",
      conditionValues: rule.conditions[0]?.values.join(", ") ?? "",
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

  return (
    <div className="flex flex-col gap-6">
      <Container className="flex flex-col gap-3 p-6">
        <Heading level="h1">eBay category assignment rules</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Rules propose an eBay Store category for newly imported Pulse rows during review, in ascending
          priority order (lowest number evaluated first). The first enabled rule whose condition matches
          wins. If nothing matches, the fallback category below is proposed instead — and if that is not
          set or not active, no proposal is made and an Admin must choose manually.
        </Text>
        <select aria-label="Environment" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
          <option value="SANDBOX">Sandbox</option>
          <option value="PRODUCTION">Production</option>
        </select>
      </Container>

      <Container className="flex flex-col gap-3 p-6">
        <Heading level="h2">Fallback category</Heading>
        <select
          aria-label="Fallback category"
          value={fallbackId || fallbackQuery.data?.fallbackStoreCategoryId || ""}
          onChange={(event) => setFallbackId(event.target.value)}
        >
          <option value="">— None —</option>
          {activeCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.path}
            </option>
          ))}
        </select>
        <Button variant="secondary" isLoading={saveFallback.isPending} onClick={() => saveFallback.mutate()}>
          Save fallback
        </Button>
      </Container>

      <Container className="flex flex-col gap-3 p-6">
        <Heading level="h2">{editingId ? "Edit rule" : "New rule"}</Heading>
        <Label htmlFor="rule-name">Name</Label>
        <Input id="rule-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <Label htmlFor="rule-priority">Priority (lower runs first)</Label>
        <Input
          id="rule-priority"
          type="number"
          value={form.priority}
          onChange={(event) => setForm({ ...form, priority: event.target.value })}
        />
        <Label htmlFor="rule-target">Target category</Label>
        <select
          id="rule-target"
          value={form.targetStoreCategoryId}
          onChange={(event) => setForm({ ...form, targetStoreCategoryId: event.target.value })}
        >
          <option value="">— Choose —</option>
          {activeCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.path}
            </option>
          ))}
        </select>
        <Label htmlFor="rule-field">Condition field</Label>
        <select
          id="rule-field"
          value={form.conditionField}
          onChange={(event) => setForm({ ...form, conditionField: event.target.value as ConditionField })}
        >
          {FIELD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Label htmlFor="rule-values">Matching values (comma-separated)</Label>
        <Input
          id="rule-values"
          value={form.conditionValues}
          onChange={(event) => setForm({ ...form, conditionValues: event.target.value })}
          placeholder="e.g. REVERSE_HOLO"
        />
        <div className="flex gap-3">
          <Button
            disabled={!form.name.trim() || !form.targetStoreCategoryId || !form.conditionValues.trim()}
            isLoading={save.isPending}
            onClick={() => save.mutate()}
          >
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
        {rulesQuery.isError && <Text role="alert">Rules could not be loaded.</Text>}
        <table className="w-full text-left">
          <thead>
            <tr>
              <th>Priority</th>
              <th>Name</th>
              <th>Target category</th>
              <th>Condition</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(rulesQuery.data?.rules ?? []).map((rule) => (
              <tr key={rule.id}>
                <td>{rule.priority}</td>
                <td>{rule.name}</td>
                <td>{categoryName(rule.targetStoreCategoryId)}</td>
                <td>
                  {rule.conditions.map((condition, index) => (
                    <Badge key={index} className="mr-1">
                      {condition.field}: {condition.values.join(", ")}
                    </Badge>
                  ))}
                </td>
                <td>
                  <Switch checked={rule.enabled} onCheckedChange={() => toggleEnabled.mutate(rule)} />
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
