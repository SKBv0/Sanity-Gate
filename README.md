# Sanity Gate

Scans your project for unused files, security issues, dependencies, and more. Outputs compact reports in three formats: plain text, JSON, or ready-to-paste prompt. Web UI + CLI. Doesn't fix anything automatically - just reports what needs attention.

## What It Checks

- **Git**: Uncommitted changes
- **Filesystem**: Empty folders, zero-byte files, backup files
- **Assets**: Unused images/files in public folder
- **Orphans**: Files that aren't imported anywhere
- **Dependencies**: Unused packages, missing deps, unpinned versions
- **Licenses**: GPL/AGPL licenses that might cause issues
- **Security**: Hardcoded API keys and secrets
- **Environment**: Missing env variables
- **SEO**: Missing metadata, images without alt text
- **Accessibility**: Inputs without labels
- **Code Quality**: console.log statements, TODO comments
- **Performance**: Sync file operations, huge files
- **Build**: TypeScript errors

## Installation

```bash
git clone https://github.com/<you>/sanity-gate.git
cd sanity-gate
npm install
npm link  # Optional: enables global CLI access (use `npx sanity-gate scan` from any directory)
```

To uninstall the global command:

```bash
npm uninstall -g sanity-gate
```

## Configuration (Optional)

Create a `.env` file (or copy from `.env.example`) with the following variables:

### API Token (Recommended)

```env
# Backend expects this token in all requests
SANITY_GATE_TOKEN=please-change-me

# Automatically added to UI fetch requests
NEXT_PUBLIC_SANITY_GATE_TOKEN=please-change-me

# Optional: separate secret for file preview signature
SANITY_GATE_SIGNATURE=another-secret-if-you-want
```

If tokens are defined, `/api/scan` and `/api/file-preview` require this header value. UI/CLI automatically includes it; external requests without it return 401. Leave tokens empty to allow unrestricted access.

### Workspace Guard

```env
# Where to allow scanning (defaults to current directory)
SANITY_GATE_ROOT=/path/to/allowed/workspace

# Lock it down to only scan that directory (true/false)
SANITY_GATE_ENFORCE_ROOT=false
```

## Usage

### Web UI

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and scan your project.

### CLI

```bash
npx sanity-gate scan .
npx sanity-gate scan D:\projects\my-app
npx sanity-gate scan --json
npx sanity-gate scan --output report.json
```

The CLI runs TypeScript source with `tsx` by default. After cloning and running `npm install`, no extra steps are needed. The CLI also respects workspace guard settings (`SANITY_GATE_ROOT`, `SANITY_GATE_ENFORCE_ROOT`).

## Report Format

Each issue has:

- `id`: Unique ID
- `category`: Issue type (git, security, etc.)
- `type`: Specific problem
- `severity`: How bad (info, warning, error, critical)
- `path`: File path (if applicable)
- `message`: What's wrong
- `suggestedAction`: What to do about it

## Development

```bash
npm run typecheck  # Check types
npm run build      # Build it
npm run lint       # Lint it
```

## Security

- Define a random `SANITY_GATE_TOKEN` and match the client token.
- Limit the scanned path to the workspace root if possible.
- Monitor logs; failed requests return 401/403.

## License

MIT
