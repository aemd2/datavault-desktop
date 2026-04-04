# DataVault Desktop

**Your Notion data, on your computer, forever.**

DataVault is an open-source desktop app that syncs your Notion workspace to local files and lets you browse them offline. Your data stays on your machine — no cloud storage, no vendor lock-in.

> **Version 1.0.0** — run from source or build your own installer (see below).

## Features

- **One-click Notion sync** — OAuth login, no API tokens to copy
- **Real files** — pages become Markdown, databases become CSV/JSON
- **Offline viewer** — browse your pages and tables without Notion
- **Privacy-first** — your data lives on your machine, not ours

## Run from source

```bash
# Clone and install
git clone https://github.com/aemd2/datavault-desktop.git
cd datavault-desktop
npm install

# Start the app
npm run dev:electron
```

Requires: Node.js 18+ and npm.

## Build installers

```bash
npm run dist        # both platforms
npm run dist:win    # Windows .exe
npm run dist:mac    # macOS .dmg
```

## Architecture

```
electron/       Main process — window, protocol handler, CSP, IPC
src/            React app — Login, Dashboard, Viewer
supabase/       Edge Functions — Notion OAuth, sync runner (deployed separately)
```

## Links

- **Website & waitlist:** [data-freedom-hub](https://github.com/aemd2/data-freedom-hub)
- **Issues:** [Report a bug](https://github.com/aemd2/datavault-desktop/issues)

## License

MIT
