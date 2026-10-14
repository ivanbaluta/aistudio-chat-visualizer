/**
 * @file Filter criteria extraction, dataset filtering, and persistence logic.
 */

import { state, STORAGE_KEY } from './state.js';
import { DOM } from './dom.js';

/**
 * Gathers current values from all filter controls into a settings object.
 * @returns {object}
 */
export function getActiveFilters() {
    return {
        searchText: DOM.searchInput.value.toLowerCase(),
        selectedTags: state.selectedTags,
        tagMatchMode: state.tagMatchMode,
        showFavorites: DOM.favoritesFilterCheckbox.checked,
        showHasBranches: DOM.branchesFilterCheckbox.checked,
        startDate: DOM.startDateInput.value,
        endDate: DOM.endDateInput.value
    };
}

/**
 * Applies search text, tags, favorites, branch, and date filters to the full dataset.
 * @param {object} filters
 * @returns {Array<object>}
 */
export function applyFilters(filters) {
    const hasTagFilter = Boolean(filters.selectedTags?.size);
    const isAndMode = filters.tagMatchMode === 'AND';

    return state.fullChatData.filter(chat => {
        let tagMatch = true;
        if (hasTagFilter) {
            const chatTags = state.tagsData[chat.fileId] ?? [];
            if (isAndMode) {
                tagMatch = Array.from(filters.selectedTags).every(t => chatTags.includes(t));
            } else {
                tagMatch = Array.from(filters.selectedTags).some(t => chatTags.includes(t));
            }
        }

        const searchMatch = !filters.searchText || chat.fileName.toLowerCase().includes(filters.searchText);
        const favoriteMatch = !filters.showFavorites || state.favoriteIds.has(chat.fileId);
        const branchMatch = !filters.showHasBranches || (chat.parent !== null || (chat.children?.length ?? 0) > 0);
        let dateMatch = true;
        if (filters.startDate) dateMatch = new Date(chat.modifiedDate) >= new Date(filters.startDate);
        if (dateMatch && filters.endDate) {
            const end = new Date(filters.endDate);
            end.setHours(23, 59, 59, 999);
            dateMatch = new Date(chat.modifiedDate) <= end;
        }
        return tagMatch && searchMatch && favoriteMatch && branchMatch && dateMatch;
    });
}

/**
 * Recursively includes ancestors of matching chats to ensure hierarchical tree integrity.
 * @param {Array<object>} filteredChats
 * @returns {Array<object>}
 */
export function preserveBranchIntegrity(filteredChats) {
    const chatMap = new Map(state.fullChatData.map(chat => [chat.fileId, chat]));
    const finalNodesIdSet = new Set(filteredChats.map(chat => chat.fileId));
    filteredChats.forEach(chat => {
        let current = chat;
        while (current?.parent) {
            const parentId = current.parent.id.replace('prompts/', '');
            if (finalNodesIdSet.has(parentId)) break;
            finalNodesIdSet.add(parentId);
            current = chatMap.get(parentId);
        }
    });
    return state.fullChatData.filter(chat => finalNodesIdSet.has(chat.fileId));
}

/**
 * Persists current filter settings to browser localStorage.
 */
export function saveFiltersToLocalStorage() {
    try {
        const filters = {
            searchText: DOM.searchInput.value,
            selectedTags: Array.from(state.selectedTags),
            tagMatchMode: state.tagMatchMode,
            showFavorites: DOM.favoritesFilterCheckbox.checked,
            showHasBranches: DOM.branchesFilterCheckbox.checked,
            startDate: DOM.startDateInput.value,
            endDate: DOM.endDateInput.value
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch (e) {
        console.warn('Could not save filters to localStorage:', e);
    }
}

/**
 * Restores filter control states from localStorage.
 * @param {Function} [onPopulateTagFilter] - Callback to refresh tag chips UI.
 */
export function loadFiltersFromLocalStorage(onPopulateTagFilter) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const filters = JSON.parse(raw);
        if (typeof filters?.searchText === 'string') DOM.searchInput.value = filters.searchText;

        state.selectedTags.clear();
        if (Array.isArray(filters?.selectedTags)) {
            filters.selectedTags.forEach(t => {
                if (typeof t === 'string' && t) state.selectedTags.add(t);
            });
        } else if (typeof filters?.tag === 'string' && filters.tag) {
            state.selectedTags.add(filters.tag);
        }

        state.tagMatchMode = (filters?.tagMatchMode === 'AND' || filters?.tagMatchMode === 'OR')
            ? filters.tagMatchMode
            : 'OR';
        if (DOM.tagModeOrBtn && DOM.tagModeAndBtn) {
            DOM.tagModeOrBtn.classList.toggle('active', state.tagMatchMode === 'OR');
            DOM.tagModeAndBtn.classList.toggle('active', state.tagMatchMode === 'AND');
        }
        if (onPopulateTagFilter) onPopulateTagFilter();

        if (typeof filters?.showFavorites === 'boolean') DOM.favoritesFilterCheckbox.checked = filters.showFavorites;
        if (typeof filters?.showHasBranches === 'boolean') DOM.branchesFilterCheckbox.checked = filters.showHasBranches;
        if (typeof filters?.startDate === 'string') DOM.startDateInput.value = filters.startDate;
        if (typeof filters?.endDate === 'string') DOM.endDateInput.value = filters.endDate;
    } catch (e) {
        console.warn('Could not load filters from localStorage:', e);
    }
}

/**
 * Updates the tag matching mode ('OR' for Any, 'AND' for All).
 * @param {'OR' | 'AND'} mode
 * @param {Function} [onFilterChange]
 */
export function setTagMatchMode(mode, onFilterChange) {
    if (state.tagMatchMode === mode) return;
    state.tagMatchMode = mode;
    if (DOM.tagModeOrBtn && DOM.tagModeAndBtn) {
        DOM.tagModeOrBtn.classList.toggle('active', mode === 'OR');
        DOM.tagModeAndBtn.classList.toggle('active', mode === 'AND');
    }
    if (onFilterChange) onFilterChange();
}

/**
 * Resets all active filters, removes localStorage entry, and notifies caller.
 * @param {Function} [onResetComplete]
 */
export function clearFilters(onResetComplete) {
    DOM.searchInput.value = '';
    state.selectedTags.clear();
    state.tagMatchMode = 'OR';
    if (DOM.tagModeOrBtn && DOM.tagModeAndBtn) {
        DOM.tagModeOrBtn.classList.add('active');
        DOM.tagModeAndBtn.classList.remove('active');
    }

    DOM.favoritesFilterCheckbox.checked = false;
    DOM.branchesFilterCheckbox.checked = false;
    DOM.startDateInput.value = '';
    DOM.endDateInput.value = '';
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        console.warn('Could not remove filters from localStorage:', e);
    }
    if (onResetComplete) onResetComplete();
}
