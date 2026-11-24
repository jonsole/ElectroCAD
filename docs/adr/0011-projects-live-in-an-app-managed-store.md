# Projects live in an app-managed Project store with autosave; .ecad files are for import and export

As in DabbleCAD, every Project lives in the app's **Project store** and is saved automatically:
- **Desktop:** a `projects` folder in the app's data directory, one `.ecad` file per Project plus a small metadata index with thumbnails.
- **Browser:** IndexedDB.

Clicking the logo opens **Your projects**, a home screen of cards (thumbnail, name, edited time, Component count and layer count), and the app reopens the last Project at start-up. A `.ecad` file on disk is a way to bring a Project in ("Open file…" imports it into the store) or take one out ("Save as file…" on desktop, a download in the browser). It is not where the open Project is saved. This keeps one mental model across the user's DabbleCAD and ElectroCAD, and means no Project is ever lost to an unsaved tab.

## Considered Options

- **Files on disk plus a recent-files list** (the KiCad/Eagle model, and what ticket #3 first built): rejected for consistency with DabbleCAD and because browser users would have to manage downloads.
- **The store plus a linked file on disk that Save writes to:** rejected for v1 as two places of truth. It can be added later with the File System Access API.

## Consequences

- Ctrl+S saves the open Project to the store straight away; autosave also runs shortly after every change.
- The File menu becomes: New project, Open file… (import), Save as file… / Download (export), and Your projects….
- The word "Library" stays reserved for Parts and Footprints (see `CONTEXT.md`).
