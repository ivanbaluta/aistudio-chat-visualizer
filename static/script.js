/**
 * @file Main client-side entry point for the "AI Studio Chat Visualizer" application.
 * @description Coordinates data loading, UI interactions, and graph rendering via native ES modules.
 * @author ivanbaluta
 * @version 2.1.0
 */

import { state, DEBOUNCE_DELAY } from './js/state.js';
import { DOM } from './js/dom.js';
import * as api from './js/api.js';
import * as graph from './js/graph.js';
import * as filters from './js/filters.js';
import * as ui from './js/ui.js';

/**
 * Main graph update pipeline: gathers filters, filters chats, preserves branches, and renders.
 * @param {boolean} [shouldRefocus=false]
 */
export function updateGraph(shouldRefocus = false) {
    const activeFilters = filters.getActiveFilters();
    const filteredChats = filters.applyFilters(activeFilters);
    const finalData = filters.preserveBranchIntegrity(filteredChats);

    graph.renderGraph(finalData);
    graph.updateChatCounter(finalData.length, state.fullChatData.length);
    graph.handleFocus(shouldRefocus, finalData);
}

/**
 * Filter change handler debouncing rapid inputs.
 */
export function onFilterChange() {
    filters.saveFiltersToLocalStorage();
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => updateGraph(true), DEBOUNCE_DELAY);
}

/**
 * Loads all data and renders the initial visualization.
 */
export async function loadAndRender() {
    state.isFirstDraw = true;
    DOM.loadingLabel.style.display = 'block';
    DOM.networkContainer.style.display = 'none';

    await api.loadInitialData();
    ui.populateTagFilter(onFilterChange);
    ui.populateTagAddSelect();
    filters.loadFiltersFromLocalStorage(() => ui.populateTagFilter(onFilterChange));

    if (state.fullChatData.length === 0) {
        DOM.loadingLabel.innerText = "No chat data found. Click '🔄 Refresh Data from Drive' to sync your chats.";
        DOM.loadingLabel.style.display = 'block';
        DOM.chatCounter.innerText = "Showing: 0 of 0";
        return;
    }

    if (!state.network) {
        graph.createNetworkGraph(handleGraphClick);
    }
    onFilterChange();

    DOM.loadingLabel.style.display = 'none';
    DOM.networkContainer.style.display = 'block';
}

/**
 * Handles the Google Drive data refresh flow and polls background task status.
 */
async function handleRefreshClick() {
    DOM.refreshDataBtn.disabled = true;
    DOM.refreshSpinner.classList.remove('hidden');
    ui.showNotification('Initiating sync with Google Drive...', 'success', 0);

    try {
        await api.triggerRefresh();

        await new Promise((resolve, reject) => {
            const pollInterval = setInterval(async () => {
                try {
                    const statusData = await api.queryRefreshStatus();

                    if (statusData.status === 'running') {
                        if (statusData.message) {
                            ui.showNotification(statusData.message, 'success', 0);
                        }
                    } else if (statusData.status === 'success') {
                        clearInterval(pollInterval);
                        ui.showNotification('Data updated! Reloading graph...', 'success', 4000);
                        resolve(statusData);
                    } else if (statusData.status === 'error') {
                        clearInterval(pollInterval);
                        ui.showNotification(statusData.message || 'Sync failed on server.', 'error', 6000);
                        reject(new Error(statusData.message || 'Sync failed on server.'));
                    }
                } catch (pollErr) {
                    clearInterval(pollInterval);
                    ui.showNotification(pollErr.message, 'error', 6000);
                    reject(pollErr);
                }
            }, 1000);
        });

        await loadAndRender();

    } catch (error) {
        console.error('Refresh failed:', error);
        ui.showNotification(error.message, 'error', 6000);
    } finally {
        DOM.refreshDataBtn.disabled = false;
        DOM.refreshSpinner.classList.add('hidden');
    }
}

/**
 * Toggles a chat's favorite status with optimistic UI update and server rollback.
 */
async function handleFavoriteToggle() {
    if (!state.currentOpenChatId) return;
    const nodeId = state.currentOpenChatId;
    const wasFavorite = state.favoriteIds.has(nodeId);

    if (wasFavorite) {
        state.favoriteIds.delete(nodeId);
    } else {
        state.favoriteIds.add(nodeId);
    }
    ui.updateFavoriteStar(nodeId);
    state.nodesDataSet.update({ id: nodeId, color: state.favoriteIds.has(nodeId) ? '#FFD700' : '#97C2FC' });

    try {
        await api.saveFavoritesToServer(state.favoriteIds);
        updateGraph(false);
    } catch (error) {
        if (wasFavorite) {
            state.favoriteIds.add(nodeId);
        } else {
            state.favoriteIds.delete(nodeId);
        }
        ui.updateFavoriteStar(nodeId);
        state.nodesDataSet.update({ id: nodeId, color: wasFavorite ? '#FFD700' : '#97C2FC' });
        ui.showNotification(error.message, 'error');
        console.error('Favorite toggle failed:', error);
    }
}

/**
 * Adds selected tag to the currently opened chat.
 */
async function handleAddTagToChat() {
    if (!state.currentOpenChatId) return;
    const newTag = DOM.addTagSelect.value;
    if (newTag) {
        if (!state.tagsData[state.currentOpenChatId]) state.tagsData[state.currentOpenChatId] = [];
        if (!state.tagsData[state.currentOpenChatId].includes(newTag)) {
            state.tagsData[state.currentOpenChatId].push(newTag);
        }
        DOM.addTagSelect.value = '';
        ui.renderTagsForChat(state.currentOpenChatId, () => updateGraph(false));

        try {
            await api.saveTagsToServer(state.tagsData);
            updateGraph(false);
        } catch (err) {
            state.tagsData[state.currentOpenChatId] = state.tagsData[state.currentOpenChatId].filter(t => t !== newTag);
            ui.renderTagsForChat(state.currentOpenChatId, () => updateGraph(false));
            ui.showNotification(err.message, 'error');
        }
    }
}

/**
 * Handles creation of new global tags via input in the modal.
 * @param {KeyboardEvent} event
 */
async function handleNewGlobalTag(event) {
    if (event.key === 'Enter') {
        const newTag = event.target.value.trim().toLowerCase();
        if (newTag && !state.allTags.includes(newTag)) {
            state.allTags.push(newTag);
            state.allTags.sort();
            event.target.value = '';
            ui.renderAllTagsList(onFilterChange);
            ui.populateTagFilter(onFilterChange);
            ui.populateTagAddSelect();
            try {
                await api.saveAllTagsToServer(state.allTags);
            } catch (err) {
                state.allTags = state.allTags.filter(t => t !== newTag);
                ui.renderAllTagsList(onFilterChange);
                ui.populateTagFilter(onFilterChange);
                ui.populateTagAddSelect();
                ui.showNotification(err.message, 'error');
            }
        }
    }
}

/**
 * Vis.js click handler: displays details panel on node click or hides on background click.
 * @param {object} params
 */
function handleGraphClick(params) {
    if (params.nodes?.length > 0) {
        const nodeId = params.nodes[0];
        state.currentOpenChatId = nodeId;
        const chatData = state.fullChatData.find(c => c.fileId === nodeId);
        if (!chatData) return;

        ui.updateDescriptionPanel(chatData, () => updateGraph(false));
        DOM.descriptionPanel.classList.remove('hidden');
    } else {
        DOM.descriptionPanel.classList.add('hidden');
        state.currentOpenChatId = null;
    }
}

/**
 * Attaches event listeners across all interactive UI controls.
 */
function setupEventListeners() {
    Object.values(DOM)
        .filter(el => el?.id?.startsWith('filter-') && el !== DOM.filterTagsList)
        .forEach(el => {
            el.addEventListener('input', onFilterChange);
            el.addEventListener('change', onFilterChange);
        });

    if (DOM.tagModeOrBtn) {
        DOM.tagModeOrBtn.addEventListener('click', () => filters.setTagMatchMode('OR', onFilterChange));
    }
    if (DOM.tagModeAndBtn) {
        DOM.tagModeAndBtn.addEventListener('click', () => filters.setTagMatchMode('AND', onFilterChange));
    }

    if (DOM.clearFiltersBtn) {
        DOM.clearFiltersBtn.addEventListener('click', () => {
            filters.clearFilters(() => {
                ui.populateTagFilter(onFilterChange);
                updateGraph(true);
            });
        });
    }

    DOM.manageTagsBtn.addEventListener('click', () => ui.openTagManager(onFilterChange));
    DOM.closeModalBtn.addEventListener('click', () => DOM.tagManagerModal.classList.add('hidden'));
    DOM.newGlobalTagInput.addEventListener('keyup', handleNewGlobalTag);
    DOM.closeDescPanelBtn.addEventListener('click', () => DOM.descriptionPanel.classList.add('hidden'));
    DOM.favoriteStar.addEventListener('click', handleFavoriteToggle);
    DOM.addTagSelect.addEventListener('change', handleAddTagToChat);
    DOM.refreshDataBtn.addEventListener('click', handleRefreshClick);
}

/**
 * Application bootstrapper called upon DOM readiness.
 */
async function initialize() {
    setupEventListeners();
    try {
        await loadAndRender();
    } catch (error) {
        DOM.loadingLabel.innerText = "Error loading data. Click '🔄 Refresh Data from Drive' to retry.";
        console.error("Initialization Error:", error);
    }
}

document.addEventListener('DOMContentLoaded', initialize);