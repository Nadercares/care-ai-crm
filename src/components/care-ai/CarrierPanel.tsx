import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addCarrierAdjuster,
  createCarrier,
  deleteCarrierAdjuster,
  fetchCarrierAdjusters,
  fetchCarriers,
  fetchClaimCarrier,
  setClaimCarrier,
  updateCarrierNotes,
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

/**
 * Carrier panel on the claim screen. Sets the claim's insurance carrier and
 * maintains the carrier's notes and adjusters — the material the Strategy
 * agent reviews for carrier patterns.
 */
export function CarrierPanel({ dealId }: { dealId: number }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [selectedCarrierId, setSelectedCarrierId] = useState("");
  const [newCarrierName, setNewCarrierName] = useState("");

  const reportError = (e: unknown) =>
    notify(e instanceof Error ? e.message : String(e), { type: "error" });

  const carrierQuery = useQuery({
    queryKey: ["claim_carrier", dealId],
    queryFn: () => fetchClaimCarrier(dealId),
  });
  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: fetchCarriers,
  });
  const carrier = carrierQuery.data ?? null;

  const afterSet = () => {
    setPicking(false);
    setSelectedCarrierId("");
    setNewCarrierName("");
    queryClient.invalidateQueries({ queryKey: ["claim_carrier", dealId] });
  };

  const setCarrier = useMutation({
    mutationFn: (carrierId: number | null) =>
      setClaimCarrier(dealId, carrierId),
    onSuccess: afterSet,
    onError: reportError,
  });

  const createAndSet = useMutation({
    mutationFn: async () => {
      const id = await createCarrier(newCarrierName);
      await setClaimCarrier(dealId, id);
    },
    onSuccess: () => {
      afterSet();
      queryClient.invalidateQueries({ queryKey: ["carriers"] });
      notify("Carrier created and set.", { type: "info" });
    },
    onError: reportError,
  });

  return (
    <div className="m-4">
      <Separator className="mb-4" />
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Insurance Carrier</h3>
        {carrier && !picking && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setPicking(true)}
          >
            Change
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        The carrier on this claim. The Strategy &amp; Research agent reviews the
        carrier's notes, adjusters, and correspondence.
      </p>

      {carrierQuery.isError && (
        <p className="text-xs text-destructive mt-2">
          Could not load carrier data. Apply the database migration:{" "}
          <code>npx supabase db reset --local</code>.
        </p>
      )}

      {!carrier || picking ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedCarrierId}
              onValueChange={setSelectedCarrierId}
            >
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue placeholder="Choose an existing carrier…" />
              </SelectTrigger>
              <SelectContent>
                {(carriersQuery.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!selectedCarrierId || setCarrier.isPending}
              onClick={() => setCarrier.mutate(Number(selectedCarrierId))}
            >
              Set carrier
            </Button>
            {carrier && picking && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => setPicking(false)}
              >
                Cancel
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-56 text-xs"
              placeholder="…or add a new carrier"
              value={newCarrierName}
              onChange={(e) => setNewCarrierName(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!newCarrierName.trim() || createAndSet.isPending}
              onClick={() => createAndSet.mutate()}
            >
              Create &amp; set
            </Button>
          </div>
        </div>
      ) : (
        <CarrierDetails carrier={carrier} />
      )}
    </div>
  );
}

function CarrierDetails({ carrier }: { carrier: Carrier }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(carrier.notes ?? "");
  const [showForm, setShowForm] = useState(false);
  const [adj, setAdj] = useState<CarrierAdjusterInput>(EMPTY_ADJUSTER);

  const reportError = (e: unknown) =>
    notify(e instanceof Error ? e.message : String(e), { type: "error" });

  const adjustersQuery = useQuery({
    queryKey: ["carrier_adjusters", carrier.id],
    queryFn: () => fetchCarrierAdjusters(carrier.id),
  });
  const invalidateAdjusters = () =>
    queryClient.invalidateQueries({
      queryKey: ["carrier_adjusters", carrier.id],
    });

  const saveNotes = useMutation({
    mutationFn: () => updateCarrierNotes(carrier.id, notes),
    onSuccess: () => notify("Carrier notes saved.", { type: "info" }),
    onError: reportError,
  });
  const addAdjuster = useMutation({
    mutationFn: () => addCarrierAdjuster(carrier.id, adj),
    onSuccess: () => {
      setAdj(EMPTY_ADJUSTER);
      setShowForm(false);
      invalidateAdjusters();
      notify("Adjuster added.", { type: "info" });
    },
    onError: reportError,
  });
  const removeAdjuster = useMutation({
    mutationFn: deleteCarrierAdjuster,
    onSuccess: invalidateAdjusters,
    onError: reportError,
  });

  const adjusters = adjustersQuery.data ?? [];
  const setField = (key: keyof CarrierAdjusterInput, value: string) =>
    setAdj((a) => ({ ...a, [key]: value }));

  return (
    <div className="mt-3 space-y-3 text-xs">
      <div className="text-sm font-medium">{carrier.name}</div>

      <div className="space-y-1">
        <Label className="text-xs">Carrier notes / known patterns</Label>
        <Textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Record this carrier's tendencies: common denial reasons, delay tactics, clauses they lean on…"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={saveNotes.isPending}
            onClick={() => saveNotes.mutate()}
          >
            {saveNotes.isPending ? "Saving…" : "Save notes"}
          </Button>
        </div>
      </div>

      <div>
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
              <Input
                className="h-8 text-xs"
                placeholder="First name"
                value={adj.first_name}
                onChange={(e) => setField("first_name", e.target.value)}
              />
              <Input
                className="h-8 text-xs"
                placeholder="Last name"
                value={adj.last_name}
                onChange={(e) => setField("last_name", e.target.value)}
              />
              <Input
                className="h-8 text-xs"
                placeholder="License number"
                value={adj.license_number}
                onChange={(e) => setField("license_number", e.target.value)}
              />
              <Input
                className="h-8 text-xs"
                placeholder="License state"
                value={adj.license_state}
                onChange={(e) => setField("license_state", e.target.value)}
              />
              <Input
                className="h-8 text-xs"
                placeholder="Type (field / desk / independent)"
                value={adj.adjuster_type}
                onChange={(e) => setField("adjuster_type", e.target.value)}
              />
              <Input
                className="h-8 text-xs"
                placeholder="Phone"
                value={adj.phone}
                onChange={(e) => setField("phone", e.target.value)}
              />
              <Input
                className="h-8 text-xs"
                placeholder="Email"
                value={adj.email}
                onChange={(e) => setField("email", e.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={
                  addAdjuster.isPending ||
                  (!adj.first_name.trim() && !adj.last_name.trim())
                }
                onClick={() => addAdjuster.mutate()}
              >
                {addAdjuster.isPending ? "Adding…" : "Add adjuster"}
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
                  onClick={() => removeAdjuster.mutate(a.id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
