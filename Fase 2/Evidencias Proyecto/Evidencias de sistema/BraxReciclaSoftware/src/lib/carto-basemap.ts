// CARTO raster basemaps: https://www.carto.com/basemaps/
export const CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attribution/">CARTO</a>';

export function cartoDarkMatterUrl(apiKey: string | undefined): string | null {
  const key = apiKey?.trim();
  if (!key) return null;
  return `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`;
}
