"use client";

import { useState, useEffect } from "react";
import {
  ApiShipment,
  ApiShippingRate,
  fetchSwapShipments,
  fetchShipmentRates,
  purchaseLabel,
  shipShipment,
  deliverShipment,
  cancelShipmentApi,
  formatPence,
} from "@/lib/api";
import { SHIPMENT_STATUS_LABELS } from "@swapify/shared";

type Props = {
  swapId: string;
  accessToken: string;
  myUserId: string;
};

function ShipmentActions({ shipment, accessToken, onUpdated, isSender }: { shipment: ApiShipment; accessToken: string; onUpdated: () => void; isSender: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rates, setRates] = useState<ApiShippingRate[] | null>(null);
  const [fetchingRates, setFetchingRates] = useState(false);
  const amSender = isSender;

  async function handlePurchaseRate(rate: ApiShippingRate) {
    setLoading(true);
    setError(null);
    try {
      await purchaseLabel(accessToken, shipment.id, rate.carrier, rate.service);
      onUpdated();
    } catch (e: any) {
      setError(e?.message ?? "Failed to purchase label");
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchRates() {
    setFetchingRates(true);
    setError(null);
    try {
      const { rates: fetched } = await fetchShipmentRates(accessToken, shipment.id);
      setRates(fetched);
    } catch (e: any) {
      setError(e?.message ?? "Failed to fetch rates");
    } finally {
      setFetchingRates(false);
    }
  }

  async function handleShip() {
    setLoading(true);
    setError(null);
    try {
      await shipShipment(accessToken, shipment.id);
      onUpdated();
    } catch (e: any) {
      setError(e?.message ?? "Failed to mark as shipped");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeliver() {
    setLoading(true);
    setError(null);
    try {
      await deliverShipment(accessToken, shipment.id);
      onUpdated();
    } catch (e: any) {
      setError(e?.message ?? "Failed to mark as delivered");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    setLoading(true);
    setError(null);
    try {
      await cancelShipmentApi(accessToken, shipment.id);
      onUpdated();
    } catch (e: any) {
      setError(e?.message ?? "Failed to cancel shipment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="rounded-btn bg-rose-950/50 px-3 py-2 text-xs text-rose-300">{error}</p>}

      {shipment.status === "PENDING" && (
        <div className="space-y-2">
          {!rates && !fetchingRates && (
            <button onClick={handleFetchRates} disabled={loading} className="w-full rounded-btn bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50">
              Get postage rates
            </button>
          )}
          {fetchingRates && <p className="text-xs text-muted">Loading rates...</p>}
          {rates && rates.length > 0 && (
            <div className="space-y-1">
              {rates.map((rate) => (
                <button
                  key={`${rate.carrier}-${rate.service}`}
                  onClick={() => handlePurchaseRate(rate)}
                  disabled={loading}
                  className="flex w-full items-center justify-between rounded-btn border border-line bg-surface-2 px-3 py-2 text-sm text-foreground hover:border-primary disabled:opacity-50"
                >
                  <span>{rate.carrier} {rate.service}</span>
                  <span className="font-medium text-token">{formatPence(rate.pricePence)}</span>
                </button>
              ))}
            </div>
          )}
          {rates && rates.length === 0 && <p className="text-xs text-muted">No rates available</p>}
        </div>
      )}

      {shipment.status === "LABEL_READY" && amSender && (
        <button onClick={handleShip} disabled={loading} className="w-full rounded-btn bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50">
          Mark as shipped
        </button>
      )}

      {shipment.status === "IN_TRANSIT" && !amSender && (
        <button onClick={handleDeliver} disabled={loading} className="w-full rounded-btn bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600/90 disabled:opacity-50">
          Mark as delivered
        </button>
      )}

      {(shipment.status === "PENDING" || shipment.status === "LABEL_READY") && amSender && (
        <button onClick={handleCancel} disabled={loading} className="w-full rounded-btn border border-rose-500/40 px-4 py-2 text-sm text-rose-300 hover:bg-rose-950/50 disabled:opacity-50">
          Cancel shipment
        </button>
      )}
    </div>
  );
}

export default function ShippingCard({ swapId, accessToken, myUserId }: Props) {
  const [shipments, setShipments] = useState<ApiShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadShipments() {
    try {
      const { shipments: data } = await fetchSwapShipments(accessToken, swapId);
      setShipments(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load shipments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadShipments();
  }, [swapId]);

  if (loading) return <p className="text-sm text-muted">Loading shipping info...</p>;
  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (shipments.length === 0) return null;

  const myShipments = shipments.filter((s) => s.senderUserId === myUserId);
  const theirShipments = shipments.filter((s) => s.senderUserId !== myUserId);

  function StatusIcon({ status }: { status: string }) {
    if (status === "DELIVERED") return <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />;
    if (status === "IN_TRANSIT") return <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />;
    if (status === "CANCELLED") return <span className="inline-block h-2 w-2 rounded-full bg-rose-400" />;
    return <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />;
  }

  function ShipmentBlock({ shipment, label }: { shipment: ApiShipment; label: string }) {
    return (
      <div className="rounded-btn border border-line bg-surface-2 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted">{label}</p>
            <p className="mt-1 font-semibold text-foreground">{shipment.item.title}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusIcon status={shipment.status} />
            <span className="text-xs font-medium text-foreground/90">
              {SHIPMENT_STATUS_LABELS[shipment.status] ?? shipment.status}
            </span>
          </div>
        </div>

        {shipment.trackingNumber && (
          <p className="text-xs text-muted">
            Tracking: <span className="font-medium text-foreground/80">{shipment.trackingNumber}</span>
            {shipment.trackingUrl && (
              <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-primary-soft hover:underline">
                Track
              </a>
            )}
          </p>
        )}

        {shipment.addressLine1 && (
          <p className="text-xs text-muted">
            Delivery: {shipment.addressLine1}{shipment.addressLine2 ? `, ${shipment.addressLine2}` : ""}, {shipment.addressCity}, {shipment.addressPostcode}
          </p>
        )}

        {shipment.postagePence !== null && (
          <p className="text-xs text-muted">Postage: <span className="text-token">{formatPence(shipment.postagePence)}</span></p>
        )}

        {shipment.labelUrl && (
          <a href={shipment.labelUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-soft hover:underline">
            Download label
          </a>
        )}

        {shipment.shippedAt && <p className="text-xs text-muted">Shipped: {new Date(shipment.shippedAt).toLocaleString()}</p>}
        {shipment.deliveredAt && <p className="text-xs text-emerald-400">Delivered: {new Date(shipment.deliveredAt).toLocaleString()}</p>}

        <ShipmentActions shipment={shipment} accessToken={accessToken} onUpdated={loadShipments} isSender={shipment.senderUserId === myUserId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Shipping</h3>

      {myShipments.map((s) => (
        <ShipmentBlock key={s.id} shipment={s} label="Your shipment" />
      ))}
      {theirShipments.map((s) => (
        <ShipmentBlock key={s.id} shipment={s} label={`${s.sender.name}'s shipment`} />
      ))}
    </div>
  );
}
