# Planner architecture

The planner is a feature boundary at `src/planner/`. Its immutable `PlannerSession` is the sole renderable application snapshot. React owns transient presentation state only: selected tool, open panel, dialogs, and undo/redo cursor. Every durable planner change passes through `dispatch(session, command)`, which returns either a new snapshot or a structured validation result.

## Command catalog

`route.create`, `route.update`, and `route.delete` control transit services. `station.create` and `station.delete` control stops. `project.create` and `project.confirm` manage construction commitments. `select`, `camera.set`, `overlay.toggle`, `clock.set`, and `tutorial.set` change workspace state. Commands can return validation, not-found, or funds failures; the UI renders these as plain-language notices.

## Save format

Local saves are JSON under `opentransport.planner.<cityId>`. Version `1` stores only user-owned session state. `loadSession` validates the version, city identity, routes, and stations before use and reports a recoverable explanation when data is corrupt or incompatible. The `version` field is the explicit migration seam for future versions.

## Map adapter seam

`MapAdapter` and `OverlayModel` in `src/planner/types.ts` intentionally use no MapLibre types. A geographic adapter should implement lifecycle state (`loading`, `ready`, `unavailable`, or `failed`), own camera and picking, and translate the normalized route/station/project overlay model into map layers. The current fixture canvas is deliberately view-only infrastructure: it emits normalized screen-relative coordinates and stays functional when a geographic map is absent.

## Acceptance checklist

- Start or continue a city; local plans autosave and reload.
- Add station and bus, tram, or subway draft from the fixture canvas.
- Inspect routes, turn overlays on and off, create a construction commitment, and review finance.
- Use Ctrl/Cmd-Z and Ctrl/Cmd-Shift-Z for undo and redo.
- Use V, B, T, S, N, and D to switch global tools.
- Confirm focus-visible controls, reduced-motion handling, and narrow-screen context panel behavior.
