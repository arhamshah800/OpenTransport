# Saves, Profiles, and Sharing

`GameSave` is versioned (`saveVersion: 1`, `gameSchemaVersion: 1`) and includes level/version, seed, network, mutable construction, Economy ledger and loans, simulation state, player metadata, and achievements. It contains no map objects, functions, DOM objects, or circular references. Unsupported schema or level versions return clear compatibility errors.

`LocalStorageSaveRepository` is the prototype browser-save adapter; `MemorySaveRepository` makes save flows testable. Autosave policy is stored in the profile, while scheduling a production autosave cadence remains an application-shell concern so saves are never written every animation frame.

Network designs export level/version, serializable transit topology, and construction geometry only. Import checks level/version compatibility and excludes personal information. Local leaderboard/profile adapters are development-only: real competitive scores need server-side simulation verification and anti-cheat controls.
