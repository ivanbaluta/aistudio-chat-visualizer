/**
 * @file Backend API communication functions.
 */

import { state, API } from './state.js';

/**
 * Loads all initial datasets from the server in parallel.
 */
export async function loadInitialData() {
    const [favRes, tagsRes, allTagsRes, chatRes] = await Promise.all([
        fetch(API.favorites),
        fetch(API.tags),
        fetch(API.allTags),
        fetch(API.chatData)
    ]);

    state.favoriteIds = new Set(favRes.ok ? await favRes.json() : []);
    state.tagsData = tagsRes.ok ? await tagsRes.json() : {};
    state.allTags = allTagsRes.ok ? await allTagsRes.json() : [];

    if (chatRes.ok) {
        const dataFromFile = await chatRes.json();
        state.fullChatData = dataFromFile.chats || [];
        state.fullChatData.sort((a, b) => new Date(b.modifiedDate || 0) - new Date(a.modifiedDate || 0));
    } else {
        state.fullChatData = [];
    }

    const rootNode = state.fullChatData.find(chat => chat.parent === null);
    state.focusNodeId = rootNode?.fileId ?? (state.fullChatData[0]?.fileId ?? null);
}

/**
 * Persists the favorite chat IDs set to the server.
 * @param {Set<string>} favoriteIds
 */
export async function saveFavoritesToServer(favoriteIds) {
    const response = await fetch(API.favorites, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Array.from(favoriteIds))
    });
    if (!response.ok) {
        throw new Error('Failed to save favorites to server.');
    }
    return true;
}

/**
 * Persists the chat-to-tag mappings to the server.
 * @param {Record<string, string[]>} tagsData
 */
export async function saveTagsToServer(tagsData) {
    const response = await fetch(API.tags, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tagsData)
    });
    if (!response.ok) {
        throw new Error('Failed to save chat tags to server.');
    }
    return true;
}

/**
 * Persists the global list of all available tags to the server.
 * @param {string[]} allTags
 */
export async function saveAllTagsToServer(allTags) {
    const response = await fetch(API.allTags, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allTags)
    });
    if (!response.ok) {
        throw new Error('Failed to save tags to server.');
    }
    return true;
}

/**
 * Initiates the Google Drive data refresh task on the server.
 */
export async function triggerRefresh() {
    const response = await fetch(API.refreshData, { method: 'POST' });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to start data refresh.');
    }
    return response.json();
}

/**
 * Queries the current background sync task status from the server.
 */
export async function queryRefreshStatus() {
    const response = await fetch(API.refreshStatus);
    if (!response.ok) {
        throw new Error('Failed to query sync status from server.');
    }
    return response.json();
}
