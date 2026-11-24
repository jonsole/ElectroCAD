# The look and feel follows the DabbleCAD fork

ElectroCAD looks and behaves like jonsole's DabbleCAD fork (DabbleCAD Plus), so the two apps feel like one family to the same user:
- the same colour tokens (dark and light), type, buttons, menus, modals and toasts;
- the same 48px top bar with workspace tabs underneath;
- the same inline stroke-icon set and DOM helper.

The 2D editors use the fork's **Laser workspace** layout as their template: a toolbar, a hint bar, a vertical tool palette, a ruled canvas, collapsible uppercase side-panel sections, and a bottom chip strip plus status bar. Those pieces are ported rather than reinvented. Both projects are Apache-2.0, so the ported files keep DabbleCAD's attribution in `NOTICE`. When the fork's style changes, ElectroCAD follows it. It does not drift to a style of its own.

## Considered Options

- **A separate EDA-style look**, such as KiCad's or Altium's. That is familiar to EDA users, but it would split the visual language from DabbleCAD and lose the ready-made components.
