/**
 * Real EasyPost-backed ShippingLabelGateway. Never exercised by tests (test
 * env always uses FakeShippingLabelGateway, see
 * shipping_label_gateway_service.ts) - verify against an EasyPost *test* API
 * key before relying on it in production.
 */
import EasyPostModule from '@easypost/api'
import env from '#start/env'
import {
  NoMatchingRateError,
  ShippingLabelGatewayError,
  type CreateLabelShipmentParams,
  type LabelAddress,
  type LabelRefundStatus,
  type PurchasedLabel,
  type ShippingLabelGateway,
} from '#services/shipping_label_gateway_service'
import { selectLabelRate, type ShippingMethod } from '#services/shipping_service'

// The package's .d.ts is CommonJS-shaped, so under this project's ESM
// resolution TypeScript sees the default import as the module namespace -
// but at runtime (the package's .mjs build) it *is* the client class.
const EasyPost = EasyPostModule as unknown as (typeof EasyPostModule)['default']
type EasyPostClient = InstanceType<typeof EasyPost>
type EasyPostShipment = Awaited<ReturnType<EasyPostClient['Shipment']['retrieve']>>

function toEasyPostAddress(address: LabelAddress) {
  return {
    name: address.name,
    company: address.company ?? undefined,
    street1: address.street1,
    street2: address.street2 ?? undefined,
    city: address.city,
    state: address.state ?? undefined,
    zip: address.zip,
    country: address.country,
    phone: address.phone ?? undefined,
    email: address.email ?? undefined,
  }
}

export class EasyPostShippingLabelGateway implements ShippingLabelGateway {
  private client: EasyPostClient

  constructor() {
    const apiKey = env.get('EASYPOST_API_KEY')
    if (!apiKey) {
      throw new ShippingLabelGatewayError('EASYPOST_API_KEY is not configured')
    }
    this.client = new EasyPost(apiKey)
  }

  async createShipment(params: CreateLabelShipmentParams): Promise<{ providerShipmentId: string }> {
    const shipment = await this.call(() =>
      this.client.Shipment.create({
        reference: params.reference,
        to_address: toEasyPostAddress(params.toAddress),
        from_address: toEasyPostAddress(params.fromAddress),
        return_address: toEasyPostAddress(params.returnAddress),
        parcel: {
          weight: params.parcel.weightOz,
          length: params.parcel.lengthIn,
          width: params.parcel.widthIn,
          height: params.parcel.heightIn,
        },
        customs_info: params.customs
          ? {
              customs_signer: params.customs.signer,
              customs_certify: true,
              contents_type: 'merchandise',
              eel_pfc: 'NOEEI 30.37(a)',
              non_delivery_option: 'return',
              restriction_type: 'none',
              customs_items: params.customs.items.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                value: item.value,
                weight: item.weightOz,
                hs_tariff_number: item.hsTariffNumber ?? undefined,
                origin_country: item.originCountry,
              })),
            }
          : undefined,
        options: { label_format: 'PDF' },
      })
    )
    return { providerShipmentId: shipment.id }
  }

  async buyShipment(providerShipmentId: string, method: ShippingMethod): Promise<PurchasedLabel> {
    const shipment = await this.call(() => this.client.Shipment.retrieve(providerShipmentId))
    if (shipment.postage_label) {
      throw new ShippingLabelGatewayError(`Shipment ${providerShipmentId} was already purchased`)
    }

    const rate = selectLabelRate(shipment.rates ?? [], method)
    if (!rate) {
      const messages = (shipment.messages ?? []).map((message) => message.message).join('; ')
      throw new NoMatchingRateError(
        `No carrier rate available for shipping method "${method}"${messages ? ` (${messages})` : ''}`
      )
    }

    const purchased = await this.call(() => this.client.Shipment.buy(providerShipmentId, rate.id))
    const label = this.toPurchasedLabel(purchased)
    if (!label) {
      throw new ShippingLabelGatewayError(
        `Shipment ${providerShipmentId} returned no postage label`
      )
    }
    return label
  }

  async getPurchasedLabel(providerShipmentId: string): Promise<PurchasedLabel | null> {
    const shipment = await this.call(() => this.client.Shipment.retrieve(providerShipmentId))
    return this.toPurchasedLabel(shipment)
  }

  async refundLabel(providerShipmentId: string): Promise<{ refundStatus: LabelRefundStatus }> {
    const shipment = await this.call(() => this.client.Shipment.refund(providerShipmentId))
    const status = shipment.refund_status as string
    // 'not_applicable' is returned by bill-on-scan carriers: an unscanned
    // label is never charged, so there's nothing left to refund.
    const refundStatus: LabelRefundStatus =
      status === 'refunded' || status === 'not_applicable'
        ? 'refunded'
        : status === 'rejected'
          ? 'rejected'
          : 'submitted'
    return { refundStatus }
  }

  private toPurchasedLabel(shipment: EasyPostShipment): PurchasedLabel | null {
    if (!shipment.postage_label || !shipment.selected_rate) {
      return null
    }
    return {
      providerShipmentId: shipment.id,
      rateId: shipment.selected_rate.id,
      carrier: shipment.selected_rate.carrier,
      service: shipment.selected_rate.service,
      trackingCode: shipment.tracking_code,
      trackingUrl: shipment.tracker?.public_url ?? null,
      labelUrl: shipment.postage_label.label_url,
      labelPdfUrl: shipment.postage_label.label_pdf_url ?? null,
      labelFormat: shipment.postage_label.label_file_type ?? 'PDF',
      cost: shipment.selected_rate.rate,
    }
  }

  /** Normalizes SDK/network errors so callers only ever see ShippingLabelGatewayError. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      if (error instanceof ShippingLabelGatewayError || error instanceof NoMatchingRateError) {
        throw error
      }
      throw new ShippingLabelGatewayError(`EasyPost request failed: ${(error as Error).message}`)
    }
  }
}
