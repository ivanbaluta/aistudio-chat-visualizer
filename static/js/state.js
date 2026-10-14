/**
 * @file Application state and global constants.
 */

export const state = {
    fullChatData: [],
    favoriteIds: new Set(),
    tagsData: {},
    allTags: [],
    selectedTags: new Set(),
    tagMatchMode: 'OR',
    network: null,
    nodesDataSet: null,
    edgesDataSet: null,
    focusNodeId: null,
    isFirstDraw: true,
    debounceTimer: null,
    currentOpenChatId: null
};

// Expose state globally for browser console debugging if needed
if (typeof window !== 'undefined') {
    window.__visualizerState = state;
}

export const API = {
    favorites: '/api/favorites',
    tags: '/api/tags',
    allTags: '/api/all-tags',
    chatData: 'chat_data.json',
    refreshData: '/api/refresh-data',
    refreshStatus: '/api/refresh-status'
};

export const STORAGE_KEY = 'aistudio_visualizer_filters';
export const DEBOUNCE_DELAY = 300;
