"use client";

import { useState } from "react";
import {
  ApiUserAddress,
  createAddress,
  updateAddress,
  deleteAddress,
} from "@/lib/api";

type Props = {
  accessToken: string;
  addresses: ApiUserAddress[];
  onAddressesChange: (addresses: ApiUserAddress[]) => void;
  compact?: boolean;
};

const COUNTRIES = [
  { code: "GB", label: "United Kingdom" },
  { code: "IE", label: "Ireland" },
  { code: "FR", label: "France" },
  { code: "DE", label: "Germany" },
  { code: "US", label: "United States" },
];

export default function AddressForm({ accessToken, addresses, onAddressesChange, compact }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState("");
  const [country, setCountry] = useState("GB");
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setLabel("");
    setLine1("");
    setLine2("");
    setCity("");
    setPostcode("");
    setCountry("GB");
    setIsDefault(false);
    setEditingId(null);
    setShowForm(false);
    setError(null);
  }

  function startEdit(addr: ApiUserAddress) {
    setEditingId(addr.id);
    setLabel(addr.label);
    setLine1(addr.line1);
    setLine2(addr.line2 ?? "");
    setCity(addr.city);
    setPostcode(addr.postcode);
    setCountry(addr.country);
    setIsDefault(addr.isDefault);
    setShowForm(true);
    setError(null);
  }

  async function handleSave() {
    if (!label.trim() || !line1.trim() || !city.trim() || !postcode.trim()) {
      setError("Label, address line 1, city and postcode are required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const input = { label: label.trim(), line1: line1.trim(), line2: line2.trim() || undefined, city: city.trim(), postcode: postcode.trim(), country, isDefault };
      if (editingId) {
        const { address } = await updateAddress(accessToken, editingId, input);
        onAddressesChange(addresses.map((a) => (a.id === editingId ? address : a)));
      } else {
        const { address } = await createAddress(accessToken, input);
        onAddressesChange([...addresses, address]);
      }
      resetForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save address");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setLoading(true);
    try {
      await deleteAddress(accessToken, id);
      onAddressesChange(addresses.filter((a) => a.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete address");
    } finally {
      setLoading(false);
    }
  }

  if (compact && !showForm && addresses.length > 0) {
    return (
      <div className="space-y-2">
        {addresses.map((addr) => (
          <div key={addr.id} className="flex items-center justify-between rounded-btn border border-line bg-surface-2 px-3 py-2 text-sm">
            <span className="truncate">
              {addr.label}: {addr.line1}, {addr.city}, {addr.postcode}
              {addr.isDefault && <span className="ml-2 text-xs text-primary-soft">(default)</span>}
            </span>
            <div className="ml-2 flex shrink-0 gap-2">
              <button onClick={() => startEdit(addr)} className="text-xs text-primary-soft hover:underline">Edit</button>
              <button onClick={() => handleDelete(addr.id)} className="text-xs text-rose-400 hover:underline">Delete</button>
            </div>
          </div>
        ))}
        <button onClick={() => setShowForm(true)} className="text-sm font-medium text-primary-soft hover:underline">
          + Add address
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-btn bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-muted">Label (e.g. Home)</span>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full rounded-btn border border-line bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary" placeholder="Home" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Country</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)} className="mt-1 w-full rounded-btn border border-line bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary">
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-muted">Address line 1</span>
        <input type="text" value={line1} onChange={(e) => setLine1(e.target.value)} className="mt-1 w-full rounded-btn border border-line bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Address line 2 (optional)</span>
        <input type="text" value={line2} onChange={(e) => setLine2(e.target.value)} className="mt-1 w-full rounded-btn border border-line bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-muted">City</span>
          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-btn border border-line bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Postcode</span>
          <input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} className="mt-1 w-full rounded-btn border border-line bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded" />
        Set as default address
      </label>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={loading}
          className="rounded-btn bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Saving..." : editingId ? "Update" : "Save"}
        </button>
        <button onClick={resetForm} className="rounded-btn border border-line px-4 py-2 text-sm text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}
