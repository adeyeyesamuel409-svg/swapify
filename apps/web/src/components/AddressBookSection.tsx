"use client";

import { useState, useEffect } from "react";
import { ApiUserAddress, fetchAddresses } from "@/lib/api";
import AddressForm from "@/components/AddressForm";

type Props = {
  accessToken: string;
};

export default function AddressBookSection({ accessToken }: Props) {
  const [addresses, setAddresses] = useState<ApiUserAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchAddresses(accessToken)
      .then(({ addresses }) => setAddresses(addresses))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accessToken]);

  return (
    <div className="rounded-card border border-line bg-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Saved addresses</h2>
        {!showForm && addresses.length > 0 && (
          <button
            onClick={() => setShowForm(true)}
            className="text-sm font-medium text-primary-soft hover:underline"
          >
            + Add
          </button>
        )}
      </div>

      {loading && <p className="mt-2 text-xs text-muted">Loading...</p>}

      {!loading && addresses.length === 0 && !showForm && (
        <p className="mt-2 text-xs text-muted">
          No saved addresses. Add one to pre-fill shipping details on completed swaps.
        </p>
      )}

      {(!loading && addresses.length > 0 && !showForm) && (
        <div className="mt-3">
          <AddressForm
            accessToken={accessToken}
            addresses={addresses}
            onAddressesChange={(addrs) => { setAddresses(addrs); setShowForm(false); }}
            compact
          />
        </div>
      )}

      {showForm && (
        <div className="mt-3">
          <AddressForm
            accessToken={accessToken}
            addresses={addresses}
            onAddressesChange={(addrs) => { setAddresses(addrs); setShowForm(false); }}
          />
        </div>
      )}
    </div>
  );
}
