// Snap grids and the grid origin, shared by the Schematic, Board and Library editors. DOM-free.
// Each editor has a main grid and an Alt grid (used while Alt is held when drawing, moving or
// resizing), and an origin the grid, rulers and coordinates measure from.
import { mm, mil } from './units.js';

/** Grid steps offered on the Board: [nm, label]. */
export const BOARD_GRIDS = [
  [mm(0.05), '0.05 mm'], [mm(0.1), '0.1 mm'], [mm(0.25), '0.25 mm'], [mm(0.5), '0.5 mm'], [mm(1), '1 mm'], [mm(2.5), '2.5 mm'],
  [mil(5), '5 mil'], [mil(10), '10 mil'], [mil(25), '25 mil'], [mil(50), '50 mil'], [mil(100), '100 mil'],
];
/** Grid steps offered on the Schematic and in the Symbol editor (Pins connect on 50 mil by convention). */
export const SCHEMATIC_GRIDS = [
  [mil(5), '5 mil'], [mil(10), '10 mil'], [mil(25), '25 mil'], [mil(50), '50 mil'], [mil(100), '100 mil'],
  [mm(0.5), '0.5 mm'], [mm(1), '1 mm'], [mm(2.5), '2.5 mm'],
];
export const DEFAULT_SCHEMATIC_GRID = { main: mil(50), alt: mil(25) };
export const DEFAULT_BOARD_GRID = { main: mm(0.5), alt: mm(0.1) };

export const gridLabel = (nm) => [...BOARD_GRIDS, ...SCHEMATIC_GRIDS].find(([v]) => v === nm)?.[1] || `${+(nm / 1e6).toFixed(4)} mm`;

/** Set `grid.main` or `grid.alt` (nm, at least 1 µm), checking the value. */
export function setGridStep(grid, which, nm) {
  if (which !== 'main' && which !== 'alt') throw new RangeError('The grid is "main" or "alt".');
  if (!(Number.isInteger(nm) && nm >= 1000)) throw new RangeError('A grid step must be at least 0.001 mm.');
  grid[which] = nm;
}

/** Snap a point to `step` measured from `origin`. */
export const snapToGrid = ([x, y], step, origin = [0, 0]) => [Math.round((x - origin[0]) / step) * step + origin[0], Math.round((y - origin[1]) / step) * step + origin[1]];

/** Snap a length (a move's delta) to `step`. */
export const snapLength = (v, step) => Math.round(v / step) * step;
