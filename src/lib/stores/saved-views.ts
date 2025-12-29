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

/**
 * Initialize TanStack DB collection (browser only)
 */
async function getViewsCollection(): Promise<Collection<SavedView, string>> {
	if (!browser) {
		throw new Error('TanStack DB can only be initialized in the browser')
	}

	if (viewsCollection) {
		return viewsCollection
	}

	const { createCollection, localStorageCollectionOptions } = await import('@tanstack/db')

	viewsCollection = createCollection(
		localStorageCollectionOptions<SavedView, string>({
			storageKey: 'svelte-table-views-saved-views',
			getKey: (item) => item.id
		})
	)

	console.log('[SavedViews] TanStack DB collection initialized')
	return viewsCollection
}

/**
 * Load views directly from localStorage (fallback for initial load)
 */
function loadViewsFromLocalStorage(): SavedView[] {
	if (!browser) return []

	try {
		const storageKey = 'svelte-table-views-saved-views'
		const data = localStorage.getItem(storageKey)
		if (!data) return []

		const parsed = JSON.parse(data)
		// TanStack DB stores as { [id]: { versionKey, data } }
		const views = Object.values(parsed).map((item: unknown) => {
			const stored = item as { versionKey: string; data: SavedView }
			return stored.data
		})

		console.log('[SavedViews] Loaded from localStorage:', views.length, 'views')
		return views
	} catch (err) {
		console.error('[SavedViews] Failed to load from localStorage:', err)
		return []
	}
}

/**
 * Load views from TanStack DB collection
 */
async function loadViewsFromCollection(): Promise<SavedView[]> {
	if (!browser) return []

	try {
		const collection = await getViewsCollection()
		const views = collection.toArray

		// If collection is empty but localStorage has data, use localStorage directly
		// This handles the race condition where TanStack DB hasn't synced yet
		if (views.length === 0) {
			const localStorageViews = loadViewsFromLocalStorage()
			if (localStorageViews.length > 0) {
				return localStorageViews
			}
		}

		return views
	} catch (err) {
		console.error('[SavedViews] Failed to load from TanStack DB:', err)
		// Fallback to direct localStorage read
		return loadViewsFromLocalStorage()
	}
}

// All saved views (reactive store)
export const savedViews = writable<SavedView[]>([])

// Initialize views from collection on browser
if (browser) {
	loadViewsFromCollection().then((views) => {
		savedViews.set(views)
	})
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
 */
async function refreshViews(): Promise<void> {
	if (!browser) return

	try {
		const collection = await getViewsCollection()
		let views = collection.toArray

		// If collection returns fewer views than localStorage, use localStorage
		// This handles sync issues with TanStack DB
		const localStorageViews = loadViewsFromLocalStorage()
		if (localStorageViews.length > views.length) {
			console.log('[SavedViews] Refresh: Using localStorage fallback', localStorageViews.length, 'vs collection', views.length)
			views = localStorageViews
		}

		savedViews.set(views)
	} catch (err) {
		console.error('[SavedViews] Failed to refresh views:', err)
		// Fallback to direct localStorage read
		const localStorageViews = loadViewsFromLocalStorage()
		savedViews.set(localStorageViews)
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
	}
}
