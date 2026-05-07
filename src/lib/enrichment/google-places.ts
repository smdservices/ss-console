/**
 * Google Places enrichment — look up business by name + area.
 * Used for entities that don't have phone/website (e.g., from permit pipelines).
 */

const PLACES_API_URL = 'https://places.googleapis.com/v1/places:searchText'

export interface PlacesEnrichment {
  placeId: string | null
  name: string | null
  phone: string | null
  website: string | null
  rating: number | null
  reviewCount: number | null
  businessStatus: string | null
  address: string | null
  types: string[] | null
}

interface PlacesSearchOptions {
  locationBias?: {
    center: { latitude: number; longitude: number }
    radius: number
  }
  maxResultCount?: number
}

interface RawPlaceResult {
  id?: string
  displayName?: { text?: string }
  nationalPhoneNumber?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  businessStatus?: string
  formattedAddress?: string
  types?: string[]
}

function buildPlacesRequestBody(
  textQuery: string,
  options: PlacesSearchOptions
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    textQuery,
    maxResultCount: options.maxResultCount ?? 1,
  }

  if (options.locationBias) {
    body.locationBias = {
      circle: {
        center: options.locationBias.center,
        radius: options.locationBias.radius,
      },
    }
  }

  return body
}

function toPlacesEnrichment(place: RawPlaceResult | undefined): PlacesEnrichment | null {
  if (!place) return null
  return {
    placeId: place.id ?? null,
    name: place.displayName?.text ?? null,
    phone: place.nationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? null,
    businessStatus: place.businessStatus ?? null,
    address: place.formattedAddress ?? null,
    types: Array.isArray(place.types) ? place.types : null,
  }
}

async function searchGooglePlaces(
  textQuery: string,
  apiKey: string,
  options: PlacesSearchOptions = {}
): Promise<PlacesEnrichment | null> {
  const response = await fetch(PLACES_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.formattedAddress,places.types',
    },
    body: JSON.stringify(buildPlacesRequestBody(textQuery, options)),
  })

  if (!response.ok) return null

  const data: { places?: RawPlaceResult[] } = await response.json()
  return toPlacesEnrichment(data.places?.[0])
}

export async function lookupGooglePlaces(
  name: string,
  area: string | null,
  apiKey: string
): Promise<PlacesEnrichment | null> {
  const query = area ? `"${name}" near ${area}` : `"${name}" Arizona`
  return searchGooglePlaces(query, apiKey, {
    locationBias: {
      center: { latitude: 34.0, longitude: -111.5 },
      radius: 425000,
    },
  })
}

export async function lookupGooglePlaceByAddress(
  address: string,
  apiKey: string
): Promise<PlacesEnrichment | null> {
  return searchGooglePlaces(address, apiKey, {
    locationBias: {
      center: { latitude: 34.0, longitude: -111.5 },
      radius: 425000,
    },
  })
}
