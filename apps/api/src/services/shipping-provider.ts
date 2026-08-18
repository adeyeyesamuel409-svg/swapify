export interface ShippingRate {
  carrier: string;
  service: string;
  pricePence: number;
  estimatedDays: number;
}

export interface LabelPurchaseResult {
  providerShipmentId: string;
  providerLabelId: string;
  trackingNumber: string;
  trackingUrl: string;
  labelUrl: string;
  carrier: string;
  service: string;
  pricePence: number;
}

export interface TrackingUpdate {
  status: 'LABEL_READY' | 'IN_TRANSIT' | 'DELIVERED';
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
}

export interface ShippingProvider {
  name: string;
  getRates(senderPostcode: string, receiverPostcode: string, weightGrams: number): Promise<ShippingRate[]>;
  purchaseLabel(rate: ShippingRate, senderAddress: AddressSnapshot, receiverAddress: AddressSnapshot): Promise<LabelPurchaseResult>;
  getTracking(providerShipmentId: string): Promise<TrackingUpdate | null>;
  cancelShipment(providerShipmentId: string): Promise<boolean>;
  verifyWebhookSignature(body: string | Buffer, signature: string): boolean;
}

export interface AddressSnapshot {
  line1: string;
  line2?: string | null;
  city: string;
  postcode: string;
  country: string;
}

export class SimulatedShippingProvider implements ShippingProvider {
  name = 'simulated';

  async getRates(senderPostcode: string, receiverPostcode: string, weightGrams: number): Promise<ShippingRate[]> {
    void senderPostcode; void receiverPostcode; void weightGrams;
    return [
      { carrier: 'SimMail', service: 'standard', pricePence: 350, estimatedDays: 5 },
      { carrier: 'SimMail', service: 'tracked', pricePence: 500, estimatedDays: 3 },
      { carrier: 'SimExpress', service: 'next-day', pricePence: 950, estimatedDays: 1 },
    ];
  }

  async purchaseLabel(
    rate: ShippingRate,
    senderAddress: AddressSnapshot,
    receiverAddress: AddressSnapshot,
  ): Promise<LabelPurchaseResult> {
    void senderAddress; void receiverAddress;
    const id = `sim_ship_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tracking = `SIM${Date.now().toString().slice(-10)}`;
    return {
      providerShipmentId: id,
      providerLabelId: `label_${id}`,
      trackingNumber: tracking,
      trackingUrl: `https://tracking.simulated.example/${tracking}`,
      labelUrl: `https://labels.simulated.example/${id}.pdf`,
      carrier: rate.carrier,
      service: rate.service,
      pricePence: rate.pricePence,
    };
  }

  async getTracking(providerShipmentId: string): Promise<TrackingUpdate | null> {
    void providerShipmentId;
    return null;
  }

  async cancelShipment(providerShipmentId: string): Promise<boolean> {
    void providerShipmentId;
    return true;
  }

  verifyWebhookSignature(body: string | Buffer, signature: string): boolean {
    void body; void signature;
    return true;
  }
}

let defaultProvider: ShippingProvider = new SimulatedShippingProvider();

export function getShippingProvider(): ShippingProvider {
  return defaultProvider;
}

export function setShippingProvider(provider: ShippingProvider): void {
  defaultProvider = provider;
}
