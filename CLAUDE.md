# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**svelte-table-views-tanstack** is a Svelte 5 library for saving and restoring table view configurations (filters, sorting, columns) with TanStack DB persistence. It provides local-first storage with IndexedDB and reactive queries for data-heavy applications.

This is a **SvelteKit package library**, not a standalone app. The package is published to npm and consumed by other Svelte applications.

## Development Commands

### Build and Package
```bash
npm run build              # Build dev server + package library
npm run package            # Package library for distribution (runs svelte-kit sync, svelte-package, publint)
```

### Testing and Quality
```bash
npm test                   # Run Vitest tests
npm run check              # Type-check with svelte-check
npm run check:watch        # Type-check in watch mode
npm run lint               # Check code with Prettier + ESLint
npm run format             # Format code with Prettier
```

### Development
```bash
npm run dev                # Start Vite dev server (for demo/testing)
npm run preview            # Preview production build
```

## Architecture

### Core Data Flow

The package uses a **reactive bridge pattern** between Svelte stores and TanStack DB:

```
UI Components (Svelte)
    ↕ (events/props)
Svelte Stores (reactive layer)
    ↕ (async operations)
TanStack DB Collection
    ↕ (persistence)
IndexedDB (localStorage fallback)
```

### Key Files

- **`src/lib/stores/saved-views.ts`** - Core business logic. Contains all CRUD operations, store definitions, and TanStack DB integration. This is the single source of truth for view management.
- **`src/lib/components/ViewSelector.svelte`** - Dropdown component for selecting/renaming/deleting views
- **`src/lib/components/SaveViewModal.svelte`** - Modal for saving new views
- **`src/lib/types/types.ts`** - TypeScript interfaces for SavedView, TableConfig, FilterCondition, etc.
- **`src/lib/index.ts`** - Public API exports (components, stores, types)

### SSR Safety Pattern

The package must work in SSR environments (SvelteKit). All TanStack DB operations are wrapped with browser guards:

```typescript
const browser = typeof window !== 'undefined'

if (!browser) {
  throw new Error('Cannot save views on server')
}
```

The TanStack DB collection is initialized lazily via dynamic import:

```typescript
async function getViewsCollection() {
  const { createCollection, localStorageCollectionOptions } = await import('@tanstack/db')
  // ... initialize collection
}
```

### Store Architecture

- **`savedViews`** - Writable store containing all SavedView objects, synced with TanStack DB collection
- **`recentViews`** - Derived store (last 7 days, top 5, sorted by lastUsed)
- **`activeViewId`** - Writable store tracking currently selected view ID
- **`activeViewModified`** - Writable store tracking if active view has unsaved changes
- **`activeView`** - Derived store combining activeViewId + savedViews to get full view object
- **`viewActions`** - Object containing all CRUD methods (save, load, update, delete, rename, etc.)

### State Management Pattern

When a view is modified by the user, the consuming app should call `viewActions.markModified()`. This enables the split button UI pattern (Update vs Save New).

The refresh pattern after mutations:
1. Perform operation on TanStack DB collection
2. Call `refreshViews()` to sync Svelte store
3. Update active view tracking stores

## Package Build Process

This is a SvelteKit library package:

1. **`svelte-kit sync`** - Generate SvelteKit types
2. **`svelte-package`** - Package library files to `dist/`
3. **`publint`** - Validate package.json exports

The `dist/` directory is published to npm. Source files in `src/lib/` are also included for source maps.

## TypeScript Configuration

- **Strict mode enabled** - All type checking is strict
- **Module resolution: bundler** - Uses modern ESM resolution
- **`.svelte-kit/tsconfig.json`** - SvelteKit-generated types are extended

## Peer Dependencies

The package requires consumers to install:
- `svelte: ^4.0.0 || ^5.0.0`
- `@tanstack/db: ^0.5.0`

When testing locally, ensure these are installed in the demo app.

## Common Patterns

### Adding New View Actions

All view operations should:
1. Check `if (!browser)` and throw error on server
2. Use `await getViewsCollection()` to get collection instance
3. Perform operation on collection
4. Call `await refreshViews()` to sync store
5. Update tracking stores (activeViewId, activeViewModified) if needed
6. Add console.log for debugging

### Component Event Pattern

Components emit CustomEvents for parent handling:
- `ViewSelector` emits: `viewSelected`, `deleteView`
- `SaveViewModal` emits: `save`

Consumers use `on:eventName={handler}` to respond.

### Storage Limits

- Default limit: 50 views (enforced in `getStorageStats()`)
- View name: max 100 characters
- View description: max 500 characters
- Storage key: `'svelte-table-views-saved-views'`

## Tailwind CSS

Components use Tailwind CSS classes. The package includes Tailwind v4 as a devDependency for demo purposes, but consumers must provide their own Tailwind setup or override styles with custom CSS.

## Demo Application

The `src/routes/` directory contains a demo SvelteKit app for testing the components during development. This is NOT part of the published package.
