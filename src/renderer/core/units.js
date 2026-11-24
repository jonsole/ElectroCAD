// Lengths in the model are integer nanometres (ADR-0003).
export const NM_PER_MM = 1_000_000;
export const NM_PER_MIL = 25_400;

export const mm = (v) => Math.round(v * NM_PER_MM);
export const mil = (v) => Math.round(v * NM_PER_MIL);
export const toMm = (nm) => nm / NM_PER_MM;
export const toMil = (nm) => nm / NM_PER_MIL;

/** Schematic grid: 50 mil, the KiCad convention so imported symbols sit on-grid. */
export const SCH_GRID = mil(50);

export const snap = (v, grid) => Math.round(v / grid) * grid;
export const snapPt = ([x, y], grid) => [snap(x, grid), snap(y, grid)];

export function formatLength(nm, units = 'mm') {
  return units === 'mil' ? `${+toMil(nm).toFixed(1)} mil` : `${+toMm(nm).toFixed(3)} mm`;
}
