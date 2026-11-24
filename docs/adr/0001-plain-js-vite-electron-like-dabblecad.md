# Plain JavaScript, Vite and Electron, the same stack as DabbleCAD

ElectroCAD uses the same stack as DabbleCAD: framework-free JavaScript ES modules, built with Vite, running in a plain browser and as an Electron desktop app. A single `platform.js` bridge sits between the editor and the outside world. In the desktop app it calls the native shell, and in a browser it falls back to localStorage and downloads. We chose this so code, tooling, release scripts and habits carry across between the two projects. That outweighs the convenience of a UI framework, because almost all of the work happens on our own canvas, not in DOM widgets.

## Considered Options

- **TypeScript + React.** This was rejected to stay consistent with DabbleCAD. JSDoc type comments together with `// @ts-check` give most of the editor help without a compile step.
