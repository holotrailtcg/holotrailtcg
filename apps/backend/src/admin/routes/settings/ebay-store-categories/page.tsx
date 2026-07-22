import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
  Badge,
  Button,
  Container,
  Drawer,
  FocusModal,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  fetchJson,
  postAction,
} from "../../../components/imports/fetch-json";
import { buildCategoryTree, type CategoryTreeNode } from "../../../components/ebay/category-tree";

type Category = {
  id: string;
  externalId: string;
  name: string;
  parentExternalId: string | null;
  siblingOrder: number;
  level: number;
  path: string;
  status: "ACTIVE" | "REMOVED";
  source: string;
  updatedAt: string;
};
type Catalogue = { accountId: string; categories: Category[] };
type Preview = {
  previewId: string;
  valid: boolean;
  added: string[];
  changed: string[];
  unchanged: string[];
  invalid: string[];
  removed: string[];
  counts: {
    added: number;
    changed: number;
    unchanged: number;
    invalid: number;
    removed: number;
  };
  truncated: boolean;
};
type Audit = {
  id: string;
  action: string;
  categoryId: string | null;
  actorId: string;
  correlationId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};
type AuditHistory = { accountId: string; audits: Audit[] };
type CategoryNode = CategoryTreeNode<Category>;

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function AuditDetails({ details }: { details: Record<string, unknown> }) {
  const before = details.before;
  const after = details.after;
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const beforeObject = before as Record<string, unknown>;
    const afterObject = after as Record<string, unknown>;
    const keys = Array.from(
      new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]),
    ).filter(
      (key) =>
        formatAuditValue(beforeObject[key]) !== formatAuditValue(afterObject[key]),
    );
    if (keys.length === 0) return null;
    return (
      <ul className="flex flex-col gap-1">
        {keys.map((key) => (
          <li key={key}>
            <Text size="small">
              <span className="font-medium">{key}</span>:{" "}
              {formatAuditValue(beforeObject[key])} →{" "}
              {formatAuditValue(afterObject[key])}
            </Text>
          </li>
        ))}
      </ul>
    );
  }
  const entries = Object.entries(details);
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {entries.map(([key, value]) => (
        <li key={key}>
          <Text size="small">
            <span className="font-medium">{key}</span>: {formatAuditValue(value)}
          </Text>
        </li>
      ))}
    </ul>
  );
}

function formatUpdatedAt(value: string | Date): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${day}-${month}-${year}, ${hours}:${minutes}`;
}

const emptyForm = {
  externalId: "",
  name: "",
  parentExternalId: "",
  siblingOrder: "0",
};

const CategoryTreeRows = ({
  node,
  depth,
  collapsedIds,
  onToggleCollapsed,
  idFieldResetVersion,
  onRenameId,
  onEdit,
  onRemove,
}: {
  node: CategoryNode;
  depth: number;
  collapsedIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
  idFieldResetVersion: Record<string, number>;
  onRenameId: (row: Category, externalId: string) => void;
  onEdit: (row: Category) => void;
  onRemove: (row: Category) => void;
}) => {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedIds.has(node.id);
  return (
    <>
      <tr className={node.status === "REMOVED" ? "text-ui-fg-muted" : ""}>
        <td>
          <div
            className="flex items-center gap-1"
            style={{ paddingLeft: depth * 20 }}
          >
            {hasChildren ? (
              <button
                type="button"
                aria-label={
                  isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`
                }
                onClick={() => onToggleCollapsed(node.id)}
                className="flex h-5 w-5 items-center justify-center text-ui-fg-subtle"
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
            ) : (
              <span className="inline-block h-5 w-5" />
            )}
            <Text title={node.path}>{node.name}</Text>
          </div>
        </td>
        <td className="w-40">
          {node.status === "ACTIVE" ? (
            <Input
              key={`${node.id}-${idFieldResetVersion[node.id] ?? 0}`}
              aria-label={`Store category ID for ${node.path}`}
              defaultValue={node.externalId}
              onBlur={(event) => {
                const nextExternalId = event.target.value.trim();
                if (!nextExternalId || nextExternalId === node.externalId) {
                  event.target.value = node.externalId;
                  return;
                }
                onRenameId(node, nextExternalId);
              }}
            />
          ) : (
            <code>{node.externalId}</code>
          )}
        </td>
        <td className="text-center">{node.displayOrder}</td>
        <td>{node.source}</td>
        <td className="text-center">
          <Badge color={node.status === "ACTIVE" ? "green" : "grey"}>
            {node.status}
          </Badge>
        </td>
        <td>{formatUpdatedAt(node.updatedAt)}</td>
        <td>
          {node.status === "ACTIVE" && (
            <div className="flex items-center gap-2">
              <Button size="small" onClick={() => onEdit(node)}>
                Edit
              </Button>
              <Button
                size="small"
                variant="danger"
                onClick={() => onRemove(node)}
              >
                Remove locally
              </Button>
            </div>
          )}
        </td>
      </tr>
      {!isCollapsed &&
        node.children.map((child) => (
          <CategoryTreeRows
            key={child.id}
            node={child}
            depth={depth + 1}
            collapsedIds={collapsedIds}
            onToggleCollapsed={onToggleCollapsed}
            idFieldResetVersion={idFieldResetVersion}
            onRenameId={onRenameId}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        ))}
    </>
  );
};

const EbayStoreCategoriesPage = () => {
  const prompt = usePrompt();
  const client = useQueryClient();
  const [environment, setEnvironment] = useState("SANDBOX");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [removing, setRemoving] = useState<Category | null>(null);
  const [reason, setReason] = useState("");
  const [idFieldResetVersion, setIdFieldResetVersion] = useState<
    Record<string, number>
  >({});
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [auditExpanded, setAuditExpanded] = useState(false);
  const catalogue = useQuery({
    queryKey: ["ebay-store-categories", environment],
    queryFn: () =>
      fetchJson<Catalogue>(
        `/admin/ebay/store-categories?environment=${environment}`,
      ),
    retry: false,
  });
  const auditHistory = useQuery({
    queryKey: ["ebay-store-category-audits", environment],
    queryFn: () =>
      fetchJson<AuditHistory>(
        `/admin/ebay/store-categories/audit?environment=${environment}&limit=50`,
      ),
    retry: false,
  });
  const tree = useMemo(
    () => buildCategoryTree(catalogue.data?.categories ?? []),
    [catalogue.data],
  );
  const summary = useMemo(() => {
    const categories = catalogue.data?.categories ?? [];
    return {
      total: categories.length,
      active: categories.filter((category) => category.status === "ACTIVE").length,
      removed: categories.filter((category) => category.status === "REMOVED").length,
      maxLevel: categories.reduce((max, category) => Math.max(max, category.level), 0),
    };
  }, [catalogue.data]);
  const toggleCollapsed = (id: string) => {
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const refresh = () => {
    client.invalidateQueries({
      queryKey: ["ebay-store-categories", environment],
    });
    client.invalidateQueries({
      queryKey: ["ebay-store-category-audits", environment],
    });
    setPreview(null);
  };
  const syncMedusa = useMutation({
    mutationFn: () =>
      postAction<{
        summary: {
          scanned: number;
          created: number;
          updated: number;
          unchanged: number;
          failed: number;
          failures: { categoryId: string; externalId: string; message: string }[];
        };
      }>("/admin/ebay/store-categories/sync-medusa", { environment }),
    onSuccess: (result) => {
      if (result.summary.failed > 0) {
        toast.warning(`Synced with ${result.summary.failed} failure(s). See details below.`);
      } else {
        toast.success("Categories synced to Medusa.");
      }
    },
    onError: () => toast.error("The Medusa sync could not be started."),
  });
  const add = useMutation({
    mutationFn: () =>
      postAction("/admin/ebay/store-categories", {
        environment,
        externalId: form.externalId,
        name: form.name,
        parentExternalId: form.parentExternalId || null,
        siblingOrder: Number(form.siblingOrder),
      }),
    onSuccess: () => {
      setCreateOpen(false);
      toast.success("Store category added");
      refresh();
    },
    onError: () => toast.error("The Store category could not be added."),
  });
  const save = useMutation({
    mutationFn: () =>
      postAction(
        `/admin/ebay/store-categories/${encodeURIComponent(editing!.id)}`,
        {
          environment,
          name: form.name,
          parentExternalId: form.parentExternalId || null,
          siblingOrder: Number(form.siblingOrder),
        },
      ),
    onSuccess: () => {
      setEditing(null);
      toast.success("Store category updated");
      refresh();
    },
    onError: () => toast.error("The Store category could not be updated."),
  });
  const renameId = useMutation({
    mutationFn: ({ row, externalId }: { row: Category; externalId: string }) =>
      postAction(`/admin/ebay/store-categories/${encodeURIComponent(row.id)}`, {
        environment,
        name: row.name,
        parentExternalId: row.parentExternalId,
        siblingOrder: row.siblingOrder,
        externalId,
      }),
    onSuccess: () => {
      toast.success("Category ID updated");
      refresh();
    },
    onError: (_error, variables) => {
      toast.error("That Category ID could not be used — it may already be in use.");
      setIdFieldResetVersion((prev) => ({
        ...prev,
        [variables.row.id]: (prev[variables.row.id] ?? 0) + 1,
      }));
    },
  });
  const previewImport = useMutation({
    mutationFn: () =>
      postAction<{ preview: Preview }>("/admin/ebay/store-categories/preview", {
        environment,
        csv,
      }),
    onSuccess: ({ preview: value }) => setPreview(value),
    onError: () => toast.error("The CSV could not be previewed."),
  });
  const apply = useMutation({
    mutationFn: (input: { previewId: string; csv: string }) =>
      postAction("/admin/ebay/store-categories/import", {
        ...input,
        confirm: true,
      }),
    onSuccess: () => {
      toast.success("Local import applied");
      refresh();
    },
    onError: () => {
      setPreview(null);
      toast.error("The preview is no longer valid. Preview again.");
    },
  });
  const remove = async () => {
    if (!removing || !reason.trim()) return;
    if (
      !(await prompt({
        title: "Remove local category?",
        description: "This does not change eBay.",
        confirmText: "Remove locally",
        cancelText: "Cancel",
        variant: "danger",
      }))
    )
      return;
    try {
      await postAction(
        `/admin/ebay/store-categories/${encodeURIComponent(removing.id)}/remove`,
        { environment, reason: reason.trim(), confirm: true },
      );
      setRemoving(null);
      setReason("");
      toast.success("Category marked removed locally");
      refresh();
    } catch {
      toast.error("The category could not be removed.");
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <Container className="flex flex-col gap-3 p-6">
        <Heading level="h1">eBay Store categories</Heading>
        <Text role="alert">
          This mirrors eBay Store categories locally. It does not create, alter
          or remove categories on eBay, publish listings, change stock, create
          products or export inventory.
        </Text>
        <select
          aria-label="Environment"
          className="w-fit rounded-md border border-ui-border-base px-4 py-2.5 text-ui-fg-base"
          value={environment}
          onChange={(event) => {
            setEnvironment(event.target.value);
            setPreview(null);
            setCollapsedIds(new Set());
            setAuditExpanded(false);
          }}
        >
          <option value="SANDBOX">Sandbox</option>
          <option value="PRODUCTION">Production</option>
        </select>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            isLoading={syncMedusa.isPending}
            onClick={() => syncMedusa.mutate()}
          >
            Sync categories to Medusa
          </Button>
          <a href="/app/settings/ebay-category-rules">Manage assignment rules</a>
        </div>
        {syncMedusa.isPending && (
          <div role="status" className="flex items-center gap-2">
            <Text size="small" className="text-ui-fg-subtle">
              Syncing local categories to Medusa — this can take a moment for a
              large catalogue…
            </Text>
          </div>
        )}
        {syncMedusa.data && !syncMedusa.isPending && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge color="grey">Scanned {syncMedusa.data.summary.scanned}</Badge>
              <Badge color="green">Created {syncMedusa.data.summary.created}</Badge>
              <Badge color="blue">Updated {syncMedusa.data.summary.updated}</Badge>
              <Badge color="grey">Unchanged {syncMedusa.data.summary.unchanged}</Badge>
              <Badge color={syncMedusa.data.summary.failed > 0 ? "red" : "grey"}>
                Failed {syncMedusa.data.summary.failed}
              </Badge>
            </div>
            {syncMedusa.data.summary.failed > 0 && (
              <Text size="small" role="alert" className="text-ui-fg-error">
                {syncMedusa.data.summary.failures
                  .map(
                    (failure: { externalId: string; message: string }) =>
                      `${failure.externalId}: ${failure.message}`,
                  )
                  .join("; ")}
              </Text>
            )}
          </div>
        )}
      </Container>
      {catalogue.isError && (
        <Text role="alert">
          The local catalogue could not be loaded for this environment.
        </Text>
      )}
      {catalogue.data && (
        <>
          <Container className="flex flex-col gap-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Heading level="h2">
                Local hierarchy · {catalogue.data.accountId}
              </Heading>
              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => setCollapsedIds(new Set())}
                >
                  Expand all
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() =>
                    setCollapsedIds(
                      new Set(
                        catalogue.data.categories
                          .filter((category) => category.level === 1)
                          .map((category) => category.id),
                      ),
                    )
                  }
                >
                  Collapse all
                </Button>
              </div>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {summary.total} categories · {summary.active} active ·{" "}
              {summary.removed} removed · {summary.maxLevel} level
              {summary.maxLevel === 1 ? "" : "s"} deep
            </Text>
            <table className="w-full table-fixed text-left">
              <colgroup>
                <col className="w-auto" />
                <col className="w-40" />
                <col className="w-16" />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-40" />
                <col className="w-44" />
              </colgroup>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th className="text-center">Order</th>
                  <th>Source</th>
                  <th className="text-center">Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tree.map((node) => (
                  <CategoryTreeRows
                    key={node.id}
                    node={node}
                    depth={0}
                    collapsedIds={collapsedIds}
                    onToggleCollapsed={toggleCollapsed}
                    idFieldResetVersion={idFieldResetVersion}
                    onRenameId={(row, externalId) =>
                      renameId.mutate({ row, externalId })
                    }
                    onEdit={(row) => {
                      setEditing(row);
                      setForm({
                        externalId: row.externalId,
                        name: row.name,
                        parentExternalId: row.parentExternalId ?? "",
                        siblingOrder: String(row.siblingOrder),
                      });
                    }}
                    onRemove={(row) => setRemoving(row)}
                  />
                ))}
              </tbody>
            </table>
          </Container>
          <Container className="p-6">
            <Button
              onClick={() => {
                setForm(emptyForm);
                setCreateOpen(true);
              }}
            >
              Add local category
            </Button>
          </Container>
          <Container className="flex flex-col gap-3 p-6">
            <Heading level="h2">CSV import</Heading>
            <Text>
              Header:{" "}
              <code>
                ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order
              </code>
            </Text>
            <a
              download="holo-trail-ebay-store-categories-example.csv"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent("ebay_store_category_id,name,parent_ebay_store_category_id,sibling_order\n24393782015,Black Star Promo Cards,,10\n24393788015,Mega Evolution Promos,24393782015,10\n")}`}
            >
              Download example CSV
            </a>
            <Textarea
              aria-label="Store category CSV"
              value={csv}
              onChange={(event) => {
                setCsv(event.target.value);
                setPreview(null);
              }}
            />
            <input
              aria-label="Upload Store category CSV"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) =>
                event.target.files?.[0]?.text().then((value) => {
                  setCsv(value);
                  setPreview(null);
                })
              }
            />
            <Button disabled={!csv} onClick={() => previewImport.mutate()}>
              Preview import
            </Button>
            {preview && (
              <div role="status">
                <Text>
                  Added: {preview.counts.added} · Changed:{" "}
                  {preview.counts.changed} · Unchanged:{" "}
                  {preview.counts.unchanged} · Would be removed:{" "}
                  {preview.counts.removed}
                </Text>
                {preview.truncated && (
                  <Text role="alert">
                    The detailed lists below are truncated. Counts above are
                    exact.
                  </Text>
                )}
                {preview.counts.invalid ? (
                  <Text role="alert">
                    Invalid: {preview.counts.invalid}
                    {preview.invalid.length
                      ? ` (${preview.invalid.join(" ")})`
                      : ""}
                  </Text>
                ) : (
                  <Button
                    disabled={!preview.valid}
                    onClick={async () => {
                      if (
                        await prompt({
                          title: "Apply local import?",
                          description:
                            "Apply this complete snapshot to the local Store-category mirror, including the previewed removals. Nothing is sent to eBay.",
                          confirmText: "Apply import",
                          cancelText: "Cancel",
                        })
                      )
                        apply.mutate({ previewId: preview.previewId, csv });
                    }}
                  >
                    Confirm and apply import
                  </Button>
                )}
              </div>
            )}
          </Container>
          <Container className="flex flex-col gap-3 p-6">
            <div className="flex items-center justify-between gap-3">
              <Heading level="h2">Audit history</Heading>
              <Button
                size="small"
                variant="secondary"
                onClick={() => setAuditExpanded((expanded) => !expanded)}
              >
                {auditExpanded
                  ? "Hide audit history"
                  : `Show audit history${
                      auditHistory.data
                        ? ` (${auditHistory.data.audits.length})`
                        : ""
                    }`}
              </Button>
            </div>
            {auditExpanded && (
              <>
                {auditHistory.isError && (
                  <Text role="alert">Audit history could not be loaded.</Text>
                )}
                {auditHistory.data?.audits.length === 0 && (
                  <Text>No audit history for this environment.</Text>
                )}
                {auditHistory.data?.audits.map((audit) => (
                  <div
                    key={audit.id}
                    className="border-b border-ui-border-base py-3"
                  >
                    <Text weight="plus">{audit.action}</Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      {audit.actorId} ·{" "}
                      {new Date(audit.createdAt).toLocaleString("en-GB")}
                    </Text>
                    {audit.categoryId && (
                      <Text size="small" className="text-ui-fg-subtle">
                        Category record: <code>{audit.categoryId}</code>
                      </Text>
                    )}
                    {audit.details && (
                      <div className="mt-1">
                        <AuditDetails details={audit.details} />
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </Container>
        </>
      )}
      <FocusModal open={createOpen} onOpenChange={setCreateOpen}>
        <FocusModal.Content>
          <FocusModal.Header>
            <FocusModal.Title>Add local Store category</FocusModal.Title>
            <FocusModal.Description>
              Add a category to this seller account's local catalogue. This does
              not create or change a category on eBay.
            </FocusModal.Description>
          </FocusModal.Header>
          <FocusModal.Body className="flex flex-col gap-3 p-6">
            <Label htmlFor="store-category-create-id">
              Exact Store category ID
            </Label>
            <Input
              id="store-category-create-id"
              value={form.externalId}
              onChange={(event) =>
                setForm({ ...form, externalId: event.target.value })
              }
            />
            <Label htmlFor="store-category-create-name">Category name</Label>
            <Input
              id="store-category-create-name"
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
            <Label htmlFor="store-category-create-parent">
              Parent Store category ID
            </Label>
            <Input
              id="store-category-create-parent"
              value={form.parentExternalId}
              onChange={(event) =>
                setForm({ ...form, parentExternalId: event.target.value })
              }
            />
            <Label htmlFor="store-category-create-order">Sibling order</Label>
            <Input
              id="store-category-create-order"
              value={form.siblingOrder}
              onChange={(event) =>
                setForm({ ...form, siblingOrder: event.target.value })
              }
            />
          </FocusModal.Body>
          <FocusModal.Footer>
            <Button
              onClick={() => add.mutate()}
              disabled={!form.externalId || !form.name}
            >
              Add category
            </Button>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
      <Drawer
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Edit local Store category</Drawer.Title>
            <Drawer.Description>
              Update this category and its position in the local catalogue. This
              does not change the category on eBay.
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-3">
            <Label htmlFor="store-category-edit-name">Category name</Label>
            <Input
              id="store-category-edit-name"
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
            <Label htmlFor="store-category-edit-parent">
              Parent Store category ID
            </Label>
            <Input
              id="store-category-edit-parent"
              value={form.parentExternalId}
              onChange={(event) =>
                setForm({ ...form, parentExternalId: event.target.value })
              }
            />
            <Label htmlFor="store-category-edit-order">Sibling order</Label>
            <Input
              id="store-category-edit-order"
              value={form.siblingOrder}
              onChange={(event) =>
                setForm({ ...form, siblingOrder: event.target.value })
              }
            />
            <Button onClick={() => save.mutate()}>Save changes</Button>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer>
      <FocusModal
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <FocusModal.Content>
          <FocusModal.Header>
            <FocusModal.Title>Remove local Store category</FocusModal.Title>
            <FocusModal.Description>
              Remove this category and its active descendants from the local
              catalogue. This does not remove anything from eBay.
            </FocusModal.Description>
          </FocusModal.Header>
          <FocusModal.Body className="flex flex-col gap-3">
            <Label htmlFor="store-category-removal-reason">
              Removal reason
            </Label>
            <Text id="store-category-removal-reason-requirement">
              A removal reason is required.
            </Text>
            <Textarea
              id="store-category-removal-reason"
              aria-describedby="store-category-removal-reason-requirement"
              aria-invalid={!reason.trim()}
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </FocusModal.Body>
          <FocusModal.Footer>
            <Button variant="danger" disabled={!reason.trim()} onClick={remove}>
              Remove locally
            </Button>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
    </div>
  );
};
export const config = defineRouteConfig({ label: "eBay Store categories" });
export default EbayStoreCategoriesPage;
