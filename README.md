# DataVault Desktop

Your Notion data, on your computer, forever.

DataVault syncs your Notion workspace to local files (Markdown + CSV) and lets you browse them offline. Open source, privacy-first.

## Download

Go to [Releases](https://github.com/aemd2/datavault-desktop/releases) and download the installer for your platform:

- **Windows**: `.exe` installer
- **macOS**: `.dmg` disk image

## Features

- **One-click Notion sync** — OAuth login, no API tokens to copy
- **Real files** — pages become Markdown, databases become CSV + JSON
- **Offline viewer** — browse your pages and tables without Notion
- **Automatic backups** — schedule syncs so your data stays fresh
- **Privacy-first** — your data lives on your machine, encrypted at rest

## Development

```bash
# Install dependencies
npm install

# Run the desktop app (Electron + Vite)
npm run dev:electron

# Build installer
npm run dist        # both platforms
npm run dist:win    # Windows only
npm run dist:mac    # macOS only
```

## Architecture

```
electron/       Electron main process (protocol handler, CSP, IPC)
src/            React app (Login, Dashboard, Viewer, Billing)
supabase/       Edge Functions (Notion OAuth, sync runner, Stripe)
sync-engine/    Python CLI for full/incremental Notion sync
```

## License

MIT
