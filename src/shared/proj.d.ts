export const LAT0: number;
export const LON0: number;
export const KX: number;
export const KY: number;
export function proj(lon: number, lat: number): [number, number];
export function unproj(x: number, y: number): [number, number];
