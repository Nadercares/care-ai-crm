import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addCarrierAdjuster,
  deleteCarrier,
  deleteCarrierAdjuster,
  fetchAllCarriers,
  fetchCarrierAdjusters,
  saveCarrier,
  type Carrier,
  type CarrierAdjusterInput,
} from "@/api/carriers";

const EMPTY_ADJUSTER: CarrierAdjusterInput = {
  first_name: "",
  last_name: "",
  license_number: "",
  license_state: "",
  adjuster_type: "",
  phone: "",
  email: "",
};

export const CarriersPage = () => {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Carrier | "new" | null>(null);

  const {
    data: carriers = [],
    isLoading,
    isError,
  } = useQuery({ queryKey: ["all_carriers"], queryFn: fetchAllCarriers });

  const deleteMutation = useMutation({
    mutationFn: deleteCarrier,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all_carriers"] });
      notify("Carrier deleted.", { type: "info" });
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Carriers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The firm's insurance carrier directory and their adjusters. The
            Strategy and Data &amp; Reporting agents draw on this.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>New carrier</Button>
      </header>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}
      {isError && (
        <p className="text-sm text-destructive">
          Could not load carriers. Apply the database migration first:{" "}
          <code>npx supabase db reset --local</code>.
        </p>
      )}
      {!isLoading && !isError && carriers.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No carriers yet. Add the carriers the firm works with.
          </CardContent>
        </Card>
      )}

      {carriers.map((carrier) => (
        <Card key={carrier.id}>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
            <div className="min-w-0">
              <CardTitle className="text-base">{carrier.name}</CardTitle>
              <CardDescription>
                {[
                  carrier.naic_code ? `NAIC ${carrier.naic_code}` : null,
                  carrier.phone,
                  carrier.email,
                ]
                  .filter(Boolean)
                  .join(" · ") || "No contact details yet"}
              </CardDescription>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(carrier)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete "${carrier.name}"? Its adjusters will be removed too.`,
                    )
                  ) {
                    deleteMutation.mutate(carrier.id);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </CardHeader>
        </Card>
      ))}

      {editing && (
        <CarrierEditorDialog
          key={editing === "new" ? "new" : editing.id}
          carrier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["all_carriers"] });
          }}
          onClosed={() => setEditing(null)}
        />
      )}
    </div>
  );
};

CarriersPage.path = "/carriers";

function CarrierEditorDialog({
  carrier,
  onClose,
  onClosed,
  onSaved,
}: {
  carrier: Carrier | null;
  onClose: () => void;
  onClosed: () => void;
  onSaved: () => void;
}) {
  const notify = useNotify();
  const [name, setName] = useState(carrier?.name ?? "");
  const [naic, setNaic] = useState(carrier?.naic_code ?? "");
  const [phone, setPhone] = useState(carrier?.phone ?? "");
  const [email, setEmail] = useState(carrier?.email ?? "");
  const [portal, setPortal] = useState(carrier?.claims_portal_url ?? "");
  const [notes, setNotes] = useState(carrier?.notes ?? "");

  const save = useMutation({
    mutationFn: () =>
      saveCarrier({
        id: carrier?.id,
        name: name.trim(),
        naic_code: naic.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        claims_portal_url: portal.trim() || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      notify("Carrier saved.", { type: "info" });
      onSaved();
      onClosed();
    },
    onError: (e) =>
      notify(e instanceof Error ? e.message : String(e), { type: "error" }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {carrier ? `Edit ${carrier.name}` : "New carrier"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="carrier-name">Name</Label>
            <Input
              id="carrier-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. State Farm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">NAIC code</Label>
              <Input
                className="h-8 text-xs"
                value={naic}
                onChange={(e) => setNaic(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone</Label>
              <Input
                className="h-8 text-xs"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Claims email</Label>
              <Input
                className="h-8 text-xs"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Claims portal URL</Label>
              <Input
                className="h-8 text-xs"
                value={portal}
                onChange={(e) => setPortal(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes / known patterns</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="This carrier's tendencies: common denial reasons, delay tactics…"
            />
          </div>

          {carrier ? (
            <AdjusterManager carrierId={carrier.id} />
          ) : (
            <p className="text-xs text-muted-foreground border-t pt-3">
              Save the carrier first, then re-open it to add adjusters.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!name.trim() || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save carrier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjusterManager({ carrierId }: { carrierId: number }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [adj, setAdj] = useState<CarrierAdjusterInput>(EMPTY_ADJUSTER);

  const reportError = (e: unknown) =>
    notify(e instanceof Error ? e.message : String(e), { type: "error" });
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["carrier_adjusters", carrierId],
    });

  const adjustersQuery = useQuery({
    queryKey: ["carrier_adjusters", carrierId],
    queryFn: () => fetchCarrierAdjusters(carrierId),
  });

  const add = useMutation({
    mutationFn: () => addCarrierAdjuster(carrierId, adj),
    onSuccess: () => {
      setAdj(EMPTY_ADJUSTER);
      setShowForm(false);
      invalidate();
    },
    onError: reportError,
  });
  const remove = useMutation({
    mutationFn: deleteCarrierAdjuster,
    onSuccess: invalidate,
    onError: reportError,
  });

  const adjusters = adjustersQuery.data ?? [];
  const setField = (key: keyof CarrierAdjusterInput, value: string) =>
    setAdj((a) => ({ ...a, [key]: value }));

  return (
    <div className="border-t pt-3 text-xs">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold text-muted-foreground tracking-wide">
          Carrier adjusters
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => setShowForm((s) => !s)}
        >
          {showForm ? "Cancel" : "Add adjuster"}
        </Button>
      </div>

      {showForm && (
        <div className="border rounded-md p-2 space-y-2 mb-2">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["first_name", "First name"],
                ["last_name", "Last name"],
                ["license_number", "License number"],
                ["license_state", "License state"],
                ["adjuster_type", "Type (field/desk/independent)"],
                ["phone", "Phone"],
                ["email", "Email"],
              ] as const
            ).map(([key, placeholder]) => (
              <Input
                key={key}
                className="h-8 text-xs"
                placeholder={placeholder}
                value={adj[key]}
                onChange={(e) => setField(key, e.target.value)}
              />
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={
                add.isPending ||
                (!adj.first_name.trim() && !adj.last_name.trim())
              }
              onClick={() => add.mutate()}
            >
              {add.isPending ? "Adding…" : "Add adjuster"}
            </Button>
          </div>
        </div>
      )}

      {adjusters.length === 0 ? (
        <p className="text-muted-foreground">No adjusters recorded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {adjusters.map((a) => (
            <div
              key={a.id}
              className="flex items-start justify-between gap-2 border rounded-md p-2"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {[a.first_name, a.last_name].filter(Boolean).join(" ") ||
                    "(unnamed adjuster)"}
                  {a.adjuster_type ? ` · ${a.adjuster_type}` : ""}
                </div>
                <div className="text-muted-foreground">
                  {a.license_number
                    ? `Lic. ${a.license_number}${
                        a.license_state ? ` (${a.license_state})` : ""
                      }`
                    : ""}
                  {a.phone ? ` · ${a.phone}` : ""}
                  {a.email ? ` · ${a.email}` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs shrink-0"
                onClick={() => remove.mutate(a.id)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
