/**
 * Saved Views Store (TanStack DB Version)
 *
 * Reactive Svelte store for managing saved table view configurations.
 * Uses TanStack DB with localStorage persistence for reactive queries.
 *
 * Requires @tanstack/db to be installed in the consuming application.
 */

import { writable, derived, get } from 'svelte/store'
import type { SavedView, SavedViewInput } from '../types/index.js'
import type { Collection } from '@tanstack/db'

// Check if we're in browser environment
const browser = typeof window !== 'undefined'

// Active view tracking
export const activeViewId = writable<string | null>(null)
export const activeViewModified = writable<boolean>(false)

// TanStack DB collection (initialized lazily)
let viewsCollection: Collection<SavedView, string> | null = null
let collectionReadyPromise: Promise<Collection<SavedView, string>> | null = null

/**
 * Initialize TanStack DB collection and wait for it to be ready (browser only)
 * Uses onReady() to ensure localStorage data has been loaded before returning
 */
async function getViewsCollection(): Promise<Collection<SavedView, string>> {
	if (!browser) {
		throw new Error('TanStack DB can only be initialized in the browser')
	}

	// Return existing ready promise if initialization is in progress
	if (collectionReadyPromise) {
		return collectionReadyPromise
	}

	// If collection exists and is ready, return it
	if (viewsCollection && viewsCollection.isReady()) {
		return viewsCollection
	}

	// Create the ready promise
	collectionReadyPromise = (async () => {
		const { createCollection, localStorageCollectionOptions } = await import('@tanstack/db')

		viewsCollection = createCollection(
			localStorageCollectionOptions<SavedView, string>({
				storageKey: 'svelte-table-views-saved-views',
				getKey: (item) => item.id
			})
		)

		// Wait for collection to be ready (localStorage synced)
		await viewsCollection.preload()
		console.log('[SavedViews] TanStack DB collection ready via preload()')

		console.log('[SavedViews] TanStack DB collection initialized with', viewsCollection.toArray.length, 'views')
		return viewsCollection
	})()

	return collectionReadyPromise
}

// All saved views (reactive store)
export const savedViews = writable<SavedView[]>([])

// Store for tracking initialization state
export const savedViewsReady = writable<boolean>(false)

/**
 * Initialize views from collection on browser
 * Waits for TanStack DB to be ready before reading
 */
async function initializeViews(): Promise<void> {
	if (!browser) return

	try {
		const collection = await getViewsCollection()
		const views = collection.toArray
		savedViews.set(views)
		savedViewsReady.set(true)
		console.log('[SavedViews] Initialized with', views.length, 'views')
	} catch (err) {
		console.error('[SavedViews] Failed to initialize:', err)
		savedViewsReady.set(true) // Still mark as ready so UI doesn't hang
	}
}

// Start initialization
if (browser) {
	initializeViews()
}

// Recent views (last 7 days, top 5, sorted by lastUsed)
export const recentViews = derived(savedViews, ($views) => {
	const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
	return $views
		.filter((v) => v.lastUsed >= sevenDaysAgo)
		.sort((a, b) => b.lastUsed - a.lastUsed)
		.slice(0, 5)
})

// Active view (full object)
export const activeView = derived([savedViews, activeViewId], ([$views, $id]) => {
	return $id ? $views.find((v) => v.id === $id) : null
})

/**
 * Refresh views from collection and update store
 * Collection is guaranteed to be ready since getViewsCollection waits for it
 */
async function refreshViews(): Promise<void> {
	if (!browser) return

	try {
		const collection = await getViewsCollection()
		const views = collection.toArray
		savedViews.set(views)
		console.log('[SavedViews] Refreshed with', views.length, 'views')
	} catch (err) {
		console.error('[SavedViews] Failed to refresh views:', err)
	}
}

/**
 * View Actions
 *
 * CRUD operations for saved views using TanStack DB
 */
export const viewActions = {
	/**
	 * Save a new view
	 */
	async save(input: SavedViewInput): Promise<SavedView> {
		if (!browser) {
			throw new Error('Cannot save views on server')
		}

		const newView: SavedView = {
			...input,
			id: crypto.randomUUID(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
			usageCount: 0,
			lastUsed: Date.now()
		}

		const collection = await getViewsCollection()
		collection.insert(newView)
		await refreshViews()

		console.log('[SavedViews] Saved new view:', newView.name, newView.id)
		return newView
	},

	/**
	 * Load an existing view
	 * Updates usage statistics and sets as active
	 */
	async load(id: string): Promise<SavedView | undefined> {
		if (!browser) {
			throw new Error('Cannot load views on server')
		}

		const collection = await getViewsCollection()
		const view = collection.get(id)

		if (view) {
			// Update usage stats
			const newUsageCount = view.usageCount + 1
			collection.update(id, (draft) => {
				draft.usageCount = newUsageCount
				draft.lastUsed = Date.now()
			})
			await refreshViews()

			activeViewId.set(id)
			activeViewModified.set(false)

			console.log('[SavedViews] Loaded view:', view.name, 'Usage:', newUsageCount)
			return { ...view, usageCount: newUsageCount, lastUsed: Date.now() }
		} else {
			console.warn('[SavedViews] View not found:', id)
			return undefined
		}
	},

	/**
	 * Update an existing view
	 */
	async update(id: string, updates: Partial<SavedView>): Promise<void> {
		if (!browser) {
			throw new Error('Cannot update views on server')
		}

		const collection = await getViewsCollection()
		const view = collection.get(id)

		if (view) {
			collection.update(id, (draft) => {
				Object.assign(draft, updates)
				draft.updatedAt = Date.now()
			})
			await refreshViews()

			activeViewModified.set(false)
			console.log('[SavedViews] Updated view:', id)
		} else {
			console.warn('[SavedViews] Cannot update - view not found:', id)
		}
	},

	/**
	 * Delete a view
	 */
	async delete(id: string): Promise<void> {
		if (!browser) {
			throw new Error('Cannot delete views on server')
		}

		const collection = await getViewsCollection()
		const view = collection.get(id)

		if (view) {
			collection.delete(id)
			await refreshViews()

			console.log('[SavedViews] Deleted view:', view.name)

			// Clear active view if it was the deleted one
			if (get(activeViewId) === id) {
				activeViewId.set(null)
				activeViewModified.set(false)
			}
		} else {
			console.warn('[SavedViews] Cannot delete - view not found:', id)
		}
	},

	/**
	 * Rename a view
	 */
	async rename(id: string, newName: string): Promise<void> {
		if (!browser) {
			throw new Error('Cannot rename views on server')
		}

		const collection = await getViewsCollection()
		const view = collection.get(id)

		if (view) {
			collection.update(id, (draft) => {
				draft.name = newName
				draft.updatedAt = Date.now()
			})
			await refreshViews()

			console.log('[SavedViews] Renamed view:', view.name, '→', newName)
		} else {
			console.warn('[SavedViews] Cannot rename - view not found:', id)
		}
	},

	/**
	 * Mark active view as modified
	 */
	markModified(): void {
		activeViewModified.set(true)
	},

	/**
	 * Clear active view
	 */
	clearActive(): void {
		activeViewId.set(null)
		activeViewModified.set(false)
	},

	/**
	 * Check if view name already exists
	 */
	async nameExists(name: string, excludeId?: string): Promise<boolean> {
		if (!browser) return false

		const views = get(savedViews)
		return views.some((v) => v.name === name && v.id !== excludeId)
	},

	/**
	 * Get storage usage stats
	 */
	async getStorageStats(): Promise<{ count: number; limit: number; percentFull: number }> {
		if (!browser) {
			return { count: 0, limit: 50, percentFull: 0 }
		}

		const views = get(savedViews)
		const count = views.length
		const limit = 50

		return {
			count,
			limit,
			percentFull: Math.round((count / limit) * 100)
		}
	},

	/**
	 * Wait for views to be ready
	 * Returns a promise that resolves when the collection has loaded from localStorage
	 */
	async waitForReady(): Promise<void> {
		if (!browser) return

		// If already ready, return immediately
		if (get(savedViewsReady)) return

		// Wait for ready state
		return new Promise((resolve) => {
			const unsubscribe = savedViewsReady.subscribe((ready) => {
				if (ready) {
					unsubscribe()
					resolve()
				}
			})
		})
	}
}
