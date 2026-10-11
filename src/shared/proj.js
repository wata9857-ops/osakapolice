// Local equirectangular projection centred on Osaka City (shared by build tools and the app).
// x = metres east of origin, y = metres north of origin.
export const LAT0 = 34.68;
export const LON0 = 135.5;
const phi = (LAT0 * Math.PI) / 180;
export const KY = 111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
export const KX = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);

export function proj(lon, lat) {
  return [(lon - LON0) * KX, (lat - LAT0) * KY];
}
export function unproj(x, y) {
  return [LON0 + x / KX, LAT0 + y / KY];
}
