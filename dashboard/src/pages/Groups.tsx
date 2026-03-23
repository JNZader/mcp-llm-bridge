import { useState } from "react";
import { Users, Plus, Trash2, Pencil, Loader2, X } from "lucide-react";
import { useGroups, useCreateGroup, useUpdateGroup, useDeleteGroup } from "../api/hooks.ts";
import { BALANCER_STRATEGY, type ProviderGroup, type CreateGroupInput, type BalancerStrategy } from "../api/types.ts";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { EmptyState } from "../components/EmptyState.tsx";

export function Groups() {
  const { data, isLoading, error } = useGroups();
  const [showForm, setShowForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProviderGroup | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load groups: {error.message}
      </div>
    );
  }

  const groups = data?.groups ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Groups</h1>
        <button
          onClick={() => {
            setEditingGroup(null);
            setShowForm(true);
          }}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Create Group
        </button>
      </div>

      {showForm && (
        <GroupForm
          group={editingGroup}
          onClose={() => {
            setShowForm(false);
            setEditingGroup(null);
          }}
        />
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No groups configured"
          description="Create a group to load balance across providers."
        />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              onEdit={() => {
                setEditingGroup(group);
                setShowForm(true);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupRow({ group, onEdit }: { group: ProviderGroup; onEdit: () => void }) {
  const deleteGroup = useDeleteGroup();

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{group.name}</h3>
          <StatusBadge status={group.strategy} />
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          {group.modelPattern && <span>Pattern: {group.modelPattern}</span>}
          <span>{group.members.length} member{group.members.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onEdit}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            if (confirm(`Delete group "${group.name}"?`)) {
              deleteGroup.mutate(group.id);
            }
          }}
          disabled={deleteGroup.isPending}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function GroupForm({
  group,
  onClose,
}: {
  group: ProviderGroup | null;
  onClose: () => void;
}) {
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();

  const [name, setName] = useState(group?.name ?? "");
  const [modelPattern, setModelPattern] = useState(group?.modelPattern ?? "");
  const [strategy, setStrategy] = useState<BalancerStrategy>(
    group?.strategy ?? BALANCER_STRATEGY.ROUND_ROBIN,
  );
  const [members, setMembers] = useState<Array<{ provider: string; weight?: number }>>(
    group?.members ?? [{ provider: "" }],
  );

  const isEditing = group !== null;
  const isPending = createGroup.isPending || updateGroup.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validMembers = members.filter((m) => m.provider.trim() !== "");
    if (validMembers.length === 0) return;

    const input: CreateGroupInput = {
      name,
      modelPattern: modelPattern || undefined,
      strategy,
      members: validMembers,
    };

    if (strategy === BALANCER_STRATEGY.WEIGHTED) {
      const weights: Record<string, number> = {};
      for (const m of validMembers) {
        weights[m.provider] = m.weight ?? 1;
      }
      input.weights = weights;
    }

    if (isEditing) {
      updateGroup.mutate({ id: group.id, input }, { onSuccess: onClose });
    } else {
      createGroup.mutate(input, { onSuccess: onClose });
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">
          {isEditing ? "Edit Group" : "Create Group"}
        </h2>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Model Pattern</label>
            <input
              value={modelPattern}
              onChange={(e) => setModelPattern(e.target.value)}
              placeholder="e.g. gpt-4*"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as BalancerStrategy)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          >
            {Object.values(BALANCER_STRATEGY).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Members</label>
            <button
              type="button"
              onClick={() => setMembers([...members, { provider: "" }])}
              className="text-xs text-primary hover:text-primary/80"
            >
              + Add Member
            </button>
          </div>
          {members.map((member, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                required
                value={member.provider}
                onChange={(e) => {
                  const next = [...members];
                  next[idx] = { ...next[idx], provider: e.target.value };
                  setMembers(next);
                }}
                placeholder="Provider name"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {strategy === BALANCER_STRATEGY.WEIGHTED && (
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={member.weight ?? 1}
                  onChange={(e) => {
                    const next = [...members];
                    next[idx] = { ...next[idx], weight: Number(e.target.value) };
                    setMembers(next);
                  }}
                  placeholder="Weight"
                  className="w-20 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}
              {members.length > 1 && (
                <button
                  type="button"
                  onClick={() => setMembers(members.filter((_, i) => i !== idx))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEditing ? "Update" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
