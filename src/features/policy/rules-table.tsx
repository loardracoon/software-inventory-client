import { useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EllipsisVertical, GripVertical } from "lucide-react";
import { conditionText, type PolicyClass } from "@policy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, NativeSelect } from "@/components/shared/filters";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteRule, moveRule, saveRule, setDefaultClass, setRuleEnabled, type PolicyDoc, type PolicyRuleRow } from "./api";
import { ClassBadge } from "./class-badge";
import { CLASS_INFO, CLASS_ORDER, KIND_SHORT } from "./classes";
import type { Counts } from "./preview";

type RulesTableProps = {
  tenantId: string;
  doc: PolicyDoc | null;
  canEdit: boolean;
  counts: Map<string, Counts> | null;
  byDefault: Counts | null;
  changed: Set<string>;
  added: Set<string>;
  categoryName: (slug: string) => string;
  onChanged: () => void;
};

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function ReviewCell({ rule }: { rule: PolicyRuleRow }) {
  if (rule.class !== "tolerated_app") return <span className="text-text-muted">—</span>;
  if (!rule.review_by) return <Badge color="high" soft>No review date</Badge>;
  const overdue = rule.review_by < today();
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{formatDate(`${rule.review_by}T12:00:00Z`)}</span>
      {overdue ? (
        <Badge color="critical" soft>
          Overdue
        </Badge>
      ) : rule.review_by <= inDays(30) ? (
        <Badge color="high" soft>
          Due soon
        </Badge>
      ) : null}
    </span>
  );
}

export function ConditionChips({ rule, categoryName }: { rule: Pick<PolicyRuleRow, "conditions" | "match">; categoryName: (slug: string) => string }) {
  return (
    <span className="flex max-w-[380px] flex-wrap items-center gap-1.5">
      {rule.conditions.map((c, i) => (
        <span key={i} className="contents">
          {i > 0 ? <span className="font-display text-[10px] font-semibold tracking-[0.1em] text-text-muted">{rule.match === "any" ? "OR" : "AND"}</span> : null}
          <span className="rounded-[6px] bg-surface-subtle px-2 py-[3px] text-xs leading-snug [overflow-wrap:anywhere] text-text-strong">{conditionText(c, categoryName)}</span>
        </span>
      ))}
    </span>
  );
}

type RowProps = {
  rule: PolicyRuleRow;
  index: number;
  total: number;
  canEdit: boolean;
  dragDisabled: boolean;
  counts: Counts | undefined;
  status: "changed" | "added" | null;
  dropLine: "top" | "bottom" | null;
  categoryName: (slug: string) => string;
  onMove: (rule: PolicyRuleRow, position: number) => void;
  onToggle: (rule: PolicyRuleRow, enabled: boolean) => void;
  onDuplicate: (rule: PolicyRuleRow) => void;
  onDelete: (rule: PolicyRuleRow) => void;
};

function RuleRow({ rule, index, total, canEdit, dragDisabled, counts, status, dropLine, categoryName, onMove, onToggle, onDuplicate, onDelete }: RowProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.lineage_id,
    disabled: dragDisabled,
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const position = index + 1;
  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-b border-border-subtle align-top hover:bg-surface-subtle",
        !rule.enabled && "opacity-60",
        isDragging && "relative z-10 bg-surface-raised shadow-md",
        dropLine === "top" && "shadow-[inset_0_2px_0_0_var(--action)]",
        dropLine === "bottom" && "shadow-[inset_0_-2px_0_0_var(--action)]",
      )}
    >
      <td className="w-10 py-3 pr-0 pl-3">
        {canEdit ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            disabled={dragDisabled}
            aria-label={`Reorder rule ${position}: ${rule.name}`}
            className="inline-flex size-8 cursor-grab items-center justify-center rounded-sm text-text-muted hover:bg-surface-subtle hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-35"
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </td>
      <td className="w-10 px-2 py-3 font-mono text-[13px] text-text-strong">{position}</td>
      <td className="w-14 px-2 py-3">
        <Switch checked={rule.enabled} disabled={!canEdit} onCheckedChange={(v) => onToggle(rule, v)} aria-label={`Rule ${position} ${rule.name} enabled`} />
      </td>
      <td className="px-3 py-3">
        <span className="flex max-w-[240px] flex-col gap-0.5">
          <Link to={`/policies/rules/${rule.lineage_id}`} className="font-semibold no-underline">
            {rule.name}
          </Link>
          <span className="text-xs text-text-muted">Owner: {rule.owner ?? "—"}</span>
          {status ? (
            <Badge color="medium" soft className="mt-1">
              {status === "added" ? "New in draft" : "Changed in draft"}
            </Badge>
          ) : null}
        </span>
      </td>
      <td className="px-3 py-3">
        <ConditionChips rule={rule} categoryName={categoryName} />
      </td>
      <td className="px-3 py-3 text-xs text-text-muted">{rule.kinds.length === 4 ? "Everything" : rule.kinds.map((k) => KIND_SHORT[k]).join(", ")}</td>
      <td className="px-3 py-3">
        <ClassBadge cls={rule.class} />
      </td>
      <td className="px-3 py-3 text-right">
        {counts ? (
          <span className="flex flex-col items-end gap-0.5">
            <span className="font-semibold text-text-strong">{formatNumber(counts.titles)} titles</span>
            <span className="text-xs whitespace-nowrap text-text-muted">{formatNumber(counts.computers)} computers</span>
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <ReviewCell rule={rule} />
      </td>
      <td className="w-12 px-2 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for rule ${position}: ${rule.name}`}>
              <EllipsisVertical aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => navigate(`/policies/rules/${rule.lineage_id}`)}>{canEdit ? "Edit" : "View"}</DropdownMenuItem>
            {canEdit ? (
              <>
                <DropdownMenuItem onSelect={() => onDuplicate(rule)}>Duplicate</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate(`/policies/rules/new?position=${position}`)}>Insert rule above</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate(`/policies/rules/new?position=${position + 1}`)}>Insert rule below</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={position === 1} onSelect={() => onMove(rule, position - 1)}>
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={position === total} onSelect={() => onMove(rule, position + 1)}>
                  Move down
                </DropdownMenuItem>
                <DropdownMenuItem disabled={position === 1} onSelect={() => onMove(rule, 1)}>
                  Move to top
                </DropdownMenuItem>
                <DropdownMenuItem disabled={position === total} onSelect={() => onMove(rule, total)}>
                  Move to bottom
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onToggle(rule, !rule.enabled)}>{rule.enabled ? "Disable" : "Enable"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onDelete(rule)} className="text-text-critical">
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

// Firewall-style rule base: evaluated top down, first match wins, the default row is pinned last.
// Reorder by dragging the grip, by keyboard (Space, arrows, Space; Escape cancels) or from the row menu.
// Every change goes to the draft.
export function RulesTable({ tenantId, doc, canEdit, counts, byDefault, changed, added, categoryName, onChanged }: RulesTableProps) {
  const serverOrder = useMemo(() => (doc?.rules ?? []).map((r) => r.lineage_id), [doc]);
  const [localOrder, setLocalOrder] = useState<{ base: string[]; order: string[] } | null>(null);
  const order = localOrder && localOrder.base === serverOrder ? localOrder.order : serverOrder;
  const byId = useMemo(() => new Map((doc?.rules ?? []).map((r) => [r.lineage_id, r])), [doc]);
  const rules = order.map((id) => byId.get(id)).filter((r): r is PolicyRuleRow => Boolean(r));

  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<PolicyClass | "">("");
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [over, setOver] = useState<{ active: UniqueIdentifier; over: UniqueIdentifier } | null>(null);
  const [deleting, setDeleting] = useState<PolicyRuleRow | null>(null);

  const filtering = search.trim() !== "" || classFilter !== "";
  const visible = rules.filter((r) => {
    if (classFilter && r.class !== classFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [r.name, r.owner ?? "", ...r.conditions.map((c) => conditionText(c, categoryName))].some((s) => s.toLowerCase().includes(q));
  });
  const dragDisabled = !canEdit || filtering || busy;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const nameOf = (id: UniqueIdentifier) => byId.get(String(id))?.name ?? "rule";
  const positionOf = (id: UniqueIdentifier) => order.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up rule ${nameOf(active.id)}, position ${positionOf(active.id)} of ${order.length}.`,
    onDragOver: ({ active, over: o }) => (o ? `Rule ${nameOf(active.id)} is over position ${positionOf(o.id)} of ${order.length}.` : `Rule ${nameOf(active.id)} is outside the list.`),
    onDragEnd: ({ active, over: o }) => (o ? `Rule ${nameOf(active.id)} dropped at position ${positionOf(o.id)} of ${order.length}.` : `Rule ${nameOf(active.id)} was dropped outside the list.`),
    onDragCancel: ({ active }) => `Reorder cancelled. Rule ${nameOf(active.id)} stays at position ${positionOf(active.id)}.`,
  };

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      if (success) setAnnouncement(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The change failed");
      setLocalOrder(null);
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  function move(rule: PolicyRuleRow, position: number) {
    const from = order.indexOf(rule.lineage_id);
    const to = Math.min(Math.max(position - 1, 0), order.length - 1);
    if (from === to) return;
    setLocalOrder({ base: serverOrder, order: arrayMove(order, from, to) });
    void run(() => moveRule(tenantId, rule.lineage_id, to + 1), `Rule ${rule.name} moved to position ${to + 1} of ${order.length}.`);
  }

  function onDragOver(event: DragOverEvent) {
    setOver(event.over ? { active: event.active.id, over: event.over.id } : null);
  }

  function onDragEnd(event: DragEndEvent) {
    setOver(null);
    if (!event.over || event.active.id === event.over.id) return;
    const rule = byId.get(String(event.active.id));
    if (rule) move(rule, order.indexOf(String(event.over.id)) + 1);
  }

  function dropLine(id: string): "top" | "bottom" | null {
    if (!over || over.over !== id || over.active === id) return null;
    return order.indexOf(String(over.active)) < order.indexOf(id) ? "bottom" : "top";
  }

  function duplicate(rule: PolicyRuleRow) {
    void run(
      () =>
        saveRule(tenantId, {
          position: rule.position + 1,
          name: `Copy of ${rule.name}`.slice(0, 120),
          class: rule.class,
          match: rule.match,
          kinds: rule.kinds,
          enabled: rule.enabled,
          owner: rule.owner ?? "",
          business_purpose: rule.business_purpose ?? "",
          mitigating_controls: rule.mitigating_controls ?? "",
          risk_accepted_by: rule.risk_accepted_by ?? "",
          review_by: rule.review_by ?? "",
          alert_on_new: rule.alert_on_new,
          conditions: rule.conditions,
        }),
      `Rule ${rule.name} duplicated below itself.`,
    );
  }

  const columns = ["", "#", "On", "Rule", "Conditions", "Applies to", "Class", "Matches", "Review by", ""];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-4 px-6 py-5">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
          <h2 className="m-0 font-subtitle text-xl font-normal">Rules</h2>
          <span className="text-[13px] text-text-muted">
            {rules.length} rule{rules.length === 1 ? "" : "s"} · evaluated from top to bottom · the first match sets the class
          </span>
        </div>
        <Field label="Search rules" htmlFor="rules-search" className="flex-[1_1_240px]">
          <Input id="rules-search" type="search" placeholder="Name, owner or condition" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <Field label="Class" htmlFor="rules-class" className="flex-[0_1_200px]">
          <NativeSelect
            id="rules-class"
            value={classFilter}
            onChange={(v) => setClassFilter(v as PolicyClass | "")}
            options={[{ value: "", label: "All classes" }, ...CLASS_ORDER.map((c) => ({ value: c, label: CLASS_INFO[c].label }))]}
          />
        </Field>
      </div>
      {canEdit && filtering ? (
        <p className="m-0 px-6 pb-3 text-[13px] text-text-muted" role="note">
          Clear filters to reorder.
        </p>
      ) : null}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div className="relative overflow-x-auto border-t border-border-subtle">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setOver(null)}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable: "To reorder a rule, press Space or Enter to pick it up. Use the up and down arrow keys to move it, Space or Enter to drop it, or Escape to cancel.",
            },
          }}
        >
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <caption className="sr-only">Policy rules, evaluated from top to bottom</caption>
            <thead>
              <tr className="border-b border-border-strong bg-surface-subtle">
                {columns.map((c, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={cn("h-11 px-3 text-left font-display text-[11px] font-semibold tracking-[0.1em] text-text-muted uppercase", c === "Matches" && "text-right")}
                  >
                    {c || <span className="sr-only">{i === 0 ? "Reorder" : "Actions"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <SortableContext items={visible.map((r) => r.lineage_id)} strategy={verticalListSortingStrategy}>
                {visible.map((rule) => (
                  <RuleRow
                    key={rule.lineage_id}
                    rule={rule}
                    index={order.indexOf(rule.lineage_id)}
                    total={order.length}
                    canEdit={canEdit}
                    dragDisabled={dragDisabled}
                    counts={counts?.get(rule.lineage_id)}
                    status={added.has(rule.lineage_id) ? "added" : changed.has(rule.lineage_id) ? "changed" : null}
                    dropLine={dropLine(rule.lineage_id)}
                    categoryName={categoryName}
                    onMove={move}
                    onToggle={(r, enabled) =>
                      void run(() => setRuleEnabled(tenantId, r.lineage_id, enabled), `Rule ${r.name} ${enabled ? "enabled" : "disabled"} in the draft.`)
                    }
                    onDuplicate={duplicate}
                    onDelete={setDeleting}
                  />
                ))}
              </SortableContext>
              {visible.length === 0 && rules.length > 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-8 text-center text-sm text-text-muted">
                    No rule matches this search.
                  </td>
                </tr>
              ) : null}
              <tr className="bg-surface-subtle align-middle">
                <td colSpan={2} className="px-3 py-4 font-mono text-[13px] text-text-muted">
                  —
                </td>
                <td colSpan={4} className="px-3 py-4">
                  <span className="flex flex-col gap-0.5">
                    <span className="font-semibold text-text-strong">Default · any title that no rule matches</span>
                    <span className="text-[13px] text-text-muted">Software nobody authorized is unauthorized until someone reviews it (CIS 2.3).</span>
                  </span>
                </td>
                <td className="px-3 py-4">
                  {canEdit && doc ? (
                    <Field label="Default class" htmlFor="default-class" className="min-w-[180px]">
                      <NativeSelect
                        id="default-class"
                        value={doc.default_class}
                        onChange={(v) => void run(() => setDefaultClass(tenantId, v as PolicyClass), `Default class set to ${CLASS_INFO[v as PolicyClass].label} in the draft.`)}
                        options={CLASS_ORDER.map((c) => ({ value: c, label: CLASS_INFO[c].label }))}
                      />
                    </Field>
                  ) : (
                    <ClassBadge cls={doc?.default_class ?? "unsanctioned_app"} />
                  )}
                </td>
                <td className="px-3 py-4 text-right">
                  {byDefault ? (
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="font-semibold text-text-strong">{formatNumber(byDefault.titles)} titles</span>
                      <span className="text-xs text-text-muted">{formatNumber(byDefault.computers)} computers</span>
                    </span>
                  ) : null}
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </DndContext>
      </div>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete rule {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>The rule is removed from the draft. The published policy stays the same until you publish.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const rule = deleting;
                setDeleting(null);
                if (rule) void run(() => deleteRule(tenantId, rule.lineage_id), `Rule ${rule.name} deleted from the draft.`);
              }}
            >
              Delete rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
