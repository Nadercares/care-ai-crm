// Weather + geocoding helpers for the Weather Research agent (Roadmap Stage 7).
// All data sources are free and need no API key:
//   - US Census geocoder    -> street address to lat/long
//   - api.zippopotam.us     -> US ZIP code to lat/long
//   - Open-Meteo archive    -> historical daily weather for a date and place
// Storm map images use Mapbox and activate only when MAPBOX_TOKEN is set.

export interface GeoLocation {
  lat: number;
  lon: number;
  label: string;
}

export async function geocodeLocation(opts: {
  address?: string | null;
  zip?: string | null;
  state?: string | null;
}): Promise<GeoLocation | null> {
  const parts = [opts.address, opts.state, opts.zip]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);

  // 1. Full / partial street address via the US Census geocoder.
  if (parts.length) {
    try {
      const query = encodeURIComponent(parts.join(", "));
      const res = await fetch(
        `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${query}&benchmark=Public_AR_Current&format=json`,
      );
      if (res.ok) {
        const json = await res.json();
        const match = json?.result?.addressMatches?.[0];
        if (match?.coordinates) {
          return {
            lat: Number(match.coordinates.y),
            lon: Number(match.coordinates.x),
            label: match.matchedAddress ?? parts.join(", "),
          };
        }
      }
    } catch {
      // fall through to ZIP lookup
    }
  }

  // 2. ZIP code via zippopotam.us.
  const zip = (opts.zip ?? "").trim();
  if (zip) {
    try {
      const res = await fetch(
        `https://api.zippopotam.us/us/${encodeURIComponent(zip)}`,
      );
      if (res.ok) {
        const json = await res.json();
        const place = json?.places?.[0];
        if (place) {
          return {
            lat: Number(place.latitude),
            lon: Number(place.longitude),
            label: `${place["place name"]}, ${place["state abbreviation"]} ${json["post code"]}`,
          };
        }
      }
    } catch {
      // give up
    }
  }

  return null;
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Fetches daily historical weather around the date of loss (a 3-day window). */
export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  dateOfLoss: string,
): Promise<unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const start = shiftDate(dateOfLoss, -1);
  let end = shiftDate(dateOfLoss, 1);
  if (end > today) end = today;

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: start,
    end_date: end,
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
  });

  const res = await fetch(
    `https://archive-api.open-meteo.com/v1/archive?${params.toString()}`,
  );
  if (!res.ok) {
    throw new Error(`weather archive responded ${res.status}`);
  }
  return await res.json();
}

/** Builds a Mapbox satellite static-map URL, or null if no token is set. */
export function buildMapUrl(lat: number, lon: number): string | null {
  const token = Deno.env.get("MAPBOX_TOKEN");
  if (!token) return null;
  return (
    `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/` +
    `pin-l+c9a84c(${lon},${lat})/${lon},${lat},15,0/640x400@2x` +
    `?access_token=${token}`
  );
}
