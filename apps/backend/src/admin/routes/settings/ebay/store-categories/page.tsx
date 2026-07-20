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
import { useState } from "react";
import {
  fetchJson,
  postAction,
} from "../../../../components/imports/fetch-json";

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
const emptyForm = {
  externalId: "",
  name: "",
  parentExternalId: "",
  siblingOrder: "0",
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
  const refresh = () => {
    client.invalidateQueries({
      queryKey: ["ebay-store-categories", environment],
    });
    client.invalidateQueries({
      queryKey: ["ebay-store-category-audits", environment],
    });
    setPreview(null);
  };
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
          value={environment}
          onChange={(event) => {
            setEnvironment(event.target.value);
            setPreview(null);
          }}
        >
          <option value="SANDBOX">Sandbox</option>
          <option value="PRODUCTION">Production</option>
        </select>
      </Container>
      {catalogue.isError && (
        <Text role="alert">
          The local catalogue could not be loaded for this environment.
        </Text>
      )}
      {catalogue.data && (
        <>
          <Container className="p-6">
            <Heading level="h2">
              Local hierarchy · {catalogue.data.accountId}
            </Heading>
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>Path</th>
                  <th>ID</th>
                  <th>Level</th>
                  <th>Order</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {catalogue.data.categories.map((row) => (
                  <tr
                    key={row.id}
                    className={
                      row.status === "REMOVED" ? "text-ui-fg-muted" : ""
                    }
                  >
                    <td>{row.path}</td>
                    <td>
                      <code>{row.externalId}</code>
                    </td>
                    <td>{row.level}</td>
                    <td>{row.siblingOrder}</td>
                    <td>{row.source}</td>
                    <td>
                      <Badge color={row.status === "ACTIVE" ? "green" : "grey"}>
                        {row.status}
                      </Badge>
                    </td>
                    <td>{new Date(row.updatedAt).toLocaleString("en-GB")}</td>
                    <td>
                      {row.status === "ACTIVE" && (
                        <>
                          <Button
                            size="small"
                            onClick={() => {
                              setEditing(row);
                              setForm({
                                externalId: row.externalId,
                                name: row.name,
                                parentExternalId: row.parentExternalId ?? "",
                                siblingOrder: String(row.siblingOrder),
                              });
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            variant="danger"
                            onClick={() => setRemoving(row)}
                          >
                            Remove locally
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
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
            <Heading level="h2">Audit history</Heading>
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
                <Text>
                  {audit.actorId} ·{" "}
                  {new Date(audit.createdAt).toLocaleString("en-GB")}
                </Text>
                {audit.categoryId && (
                  <Text>
                    Category record: <code>{audit.categoryId}</code>
                  </Text>
                )}
                {audit.details && (
                  <pre className="whitespace-pre-wrap text-ui-fg-subtle">
                    {JSON.stringify(audit.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}
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
