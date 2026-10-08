/**
 * @file Main client-side script for the "AI Studio Chat Visualizer" application.
 * @description Manages data loading, graph rendering, filtering, and all user interactions.
 * @author ivanbaluta
 * @version 2.0.0
*/

(() => {
    // --- Application State ---
    const state = {
        fullChatData: [],
        favoriteIds: new Set(),
        tagsData: {},
        allTags: [],
        network: null,
        nodesDataSet: new vis.DataSet([]),
        edgesDataSet: new vis.DataSet([]),
        focusNodeId: null,
        isFirstDraw: true,
        debounceTimer: null,
        currentOpenChatId: null
    };
    window.__visualizerState = state;

    // --- Constants & Configuration ---
    const API = {
        favorites: '/api/favorites',
        tags: '/api/tags',
        allTags: '/api/all-tags',
        chatData: 'chat_data.json',
        refreshData: '/api/refresh-data',
        refreshStatus: '/api/refresh-status'
    };
    const DOM = {
        loadingLabel: document.getElementById("loading"),
        networkContainer: document.getElementById("mynetwork"),
        searchInput: document.getElementById('filter-search'),
        tagFilterSelect: document.getElementById('filter-by-tag'),
        favoritesFilterCheckbox: document.getElementById('filter-favorites'),
        branchesFilterCheckbox: document.getElementById('filter-has-branches'),
        startDateInput: document.getElementById('filter-date-start'),
        endDateInput: document.getElementById('filter-date-end'),
        chatCounter: document.getElementById('chat-counter'),
        descriptionPanel: document.getElementById('description-panel'),
        descTitle: document.getElementById('desc-title'),
        favoriteStar: document.getElementById('favorite-star'),
        createdDateEl: document.getElementById('desc-created-date'),
        modifiedDateEl: document.getElementById('desc-modified-date'),
        descContent: document.getElementById('desc-content'),
        sourceFileLink: document.getElementById('source-file-link'),
        addTagSelect: document.getElementById('add-tag-select'),
        descTagsList: document.getElementById('desc-tags-list'),
        closeDescPanelBtn: document.getElementById('close-panel-btn'),
        tagManagerModal: document.getElementById('tag-manager-modal'),
        manageTagsBtn: document.getElementById('manage-tags-btn'),
        closeModalBtn: document.querySelector('#tag-manager-modal .close-modal-btn'),
        allTagsList: document.getElementById('all-tags-list'),
        newGlobalTagInput: document.getElementById('new-global-tag-input'),
        refreshDataBtn: document.getElementById('refresh-data-btn'),
        refreshSpinner: document.getElementById('refresh-spinner'),
        clearFiltersBtn: document.getElementById('clear-filters-btn'),
        notificationBar: document.getElementById('notification-bar')
    };
    const DEBOUNCE_DELAY = 300; // Delay in ms for debouncing user input.
    const STORAGE_KEY = 'aistudio_visualizer_filters';

    // --- Core Logic ---

    /**
     * @async
     * @description Loads all data and renders the graph.
    */
    async function loadAndRender() {
        state.isFirstDraw = true;
        DOM.loadingLabel.style.display = 'block';
        DOM.networkContainer.style.display = 'none';

        await loadInitialData();
        populateUI();
        loadFiltersFromLocalStorage();

        if (state.fullChatData.length === 0) {
            DOM.loadingLabel.innerText = "No chat data found. Click '🔄 Refresh Data from Drive' to sync your chats.";
            DOM.loadingLabel.style.display = 'block';
            DOM.chatCounter.innerText = "Showing: 0 of 0";
            return;
        }

        if (!state.network) {
            createNetworkGraph();
        }
        onFilterChange();

        DOM.loadingLabel.style.display = 'none';
        DOM.networkContainer.style.display = 'block';
    }

    /**
     * @async
     * @description Main entry point. Called once when the page loads.
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

    let notificationTimeout = null;

    /**
     * @description Displays a status message to the user.
     * @param {string} message
     * @param {'success' | 'error'} type
     * @param {number} [duration=5000] - Duration in ms before hiding. 0 to keep visible.
    */
    function showNotification(message, type, duration = 5000) {
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
            notificationTimeout = null;
        }

        DOM.notificationBar.textContent = message;
        DOM.notificationBar.className = type; // 'success' or 'error'
        
        if (duration > 0) {
            notificationTimeout = setTimeout(() => {
                DOM.notificationBar.className = 'hidden';
                notificationTimeout = null;
            }, duration);
        }
    }

    /**
     * @async
     * @description Handler for the data refresh button.
    */
    async function handleRefreshClick() {
        DOM.refreshDataBtn.disabled = true;
        DOM.refreshSpinner.classList.remove('hidden');
        showNotification('Initiating sync with Google Drive...', 'success', 0);

        try {
            const startResponse = await fetch(API.refreshData, { method: 'POST' });
            if (!startResponse.ok) {
                const errorData = await startResponse.json();
                throw new Error(errorData.message || 'Failed to start data refresh.');
            }

            // Poll background sync status every second
            await new Promise((resolve, reject) => {
                const pollInterval = setInterval(async () => {
                    try {
                        const statusRes = await fetch(API.refreshStatus);
                        if (!statusRes.ok) {
                            clearInterval(pollInterval);
                            return reject(new Error('Failed to query sync status from server.'));
                        }
                        const statusData = await statusRes.json();

                        if (statusData.status === 'running') {
                            if (statusData.message) {
                                showNotification(statusData.message, 'success', 0);
                            }
                        } else if (statusData.status === 'success') {
                            clearInterval(pollInterval);
                            showNotification('Data updated! Reloading graph...', 'success', 4000);
                            resolve(statusData);
                        } else if (statusData.status === 'error') {
                            clearInterval(pollInterval);
                            showNotification(statusData.message || 'Sync failed on server.', 'error', 6000);
                            reject(new Error(statusData.message || 'Sync failed on server.'));
                        }
                    } catch (pollErr) {
                        clearInterval(pollInterval);
                        showNotification(pollErr.message, 'error', 6000);
                        reject(pollErr);
                    }
                }, 1000);
            });

            await loadAndRender();

        } catch (error) {
            console.error('Refresh failed:', error);
            showNotification(error.message, 'error', 6000);
        } finally {
            DOM.refreshDataBtn.disabled = false;
            DOM.refreshSpinner.classList.add('hidden');
        }
    }

    /**
     * @async
     * @description Loads all necessary data from the server in parallel.
    */
    async function loadInitialData() {
        const [favRes, tagsRes, allTagsRes, chatRes] = await Promise.all([
            fetch(API.favorites), fetch(API.tags), fetch(API.allTags), fetch(API.chatData)
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
        state.focusNodeId = rootNode ? rootNode.fileId : (state.fullChatData.length > 0 ? state.fullChatData[0].fileId : null);
    }

    /**
     * @description Populates dynamic UI elements (like tag filters) with loaded data.
    */
    function populateUI() {
        populateTagFilter();
        populateTagAddSelect();
    }

    /**
     * @description Creates an instance of the Vis.js graph with specified options.
    */
    function createNetworkGraph() {
        const data = { nodes: state.nodesDataSet, edges: state.edgesDataSet };
        const options = {
            layout: {
                hierarchical: {
                    enabled: true,
                    sortMethod: "directed",
                    shakeTowards: "roots",
                    direction: 'LR',
                    levelSeparation: 400,
                    nodeSpacing: 150
                },
            },
            physics: {
                enabled: false
            },
            nodes: {
                shape: 'box',
                margin: 10,
            },
            interaction: {
                hover: true
            }
        };
        state.network = new vis.Network(DOM.networkContainer, data, options);
        state.network.on("click", handleGraphClick);
    }

    /**
     * @description The main update function. Filters data and redraws the graph.
     * @param {boolean} [shouldRefocus=false] - If true, the graph camera will focus on the result.
    */
    function updateGraph(shouldRefocus = false) {
        const filters = getActiveFilters();
        const filteredChats = applyFilters(filters);
        const finalData = preserveBranchIntegrity(filteredChats);

        renderGraph(finalData);
        updateChatCounter(finalData.length);
        handleFocus(shouldRefocus, finalData);
    }

    // --- Filtering Logic ---

    /**
     * @description Collects the current values from all filter inputs into a single object.
     * @returns {object} An object with the active filter values.
    */
    function getActiveFilters() {
        return {
            searchText: DOM.searchInput.value.toLowerCase(),
            tag: DOM.tagFilterSelect.value,
            showFavorites: DOM.favoritesFilterCheckbox.checked,
            showHasBranches: DOM.branchesFilterCheckbox.checked,
            startDate: DOM.startDateInput.value,
            endDate: DOM.endDateInput.value
        };
    }

    
    /**
     * @description Applies filters to the full chat dataset.
     * @param {object} filters - The filter settings object from getActiveFilters.
     * @returns {Array<object>} A filtered array of chats.
    */
    function applyFilters(filters) {
        return state.fullChatData.filter(chat => {
            const chatTags = state.tagsData[chat.fileId] || [];
            const tagMatch = !filters.tag || chatTags.includes(filters.tag);
            const searchMatch = !filters.searchText || chat.fileName.toLowerCase().includes(filters.searchText);
            const favoriteMatch = !filters.showFavorites || state.favoriteIds.has(chat.fileId);
            const branchMatch = !filters.showHasBranches || (chat.parent !== null || chat.children.length > 0);
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
     * @description Ensures branch integrity. If a child node is included in the filter results,
     * this function recursively adds all its ancestors to prevent broken branches.
     * @param {Array<object>} filteredChats - The array of chats after initial filtering.
     * @returns {Array<object>} The final array of chats, including all necessary ancestors.
    */
    function preserveBranchIntegrity(filteredChats) {
        const chatMap = new Map(state.fullChatData.map(chat => [chat.fileId, chat]));
        const finalNodesIdSet = new Set(filteredChats.map(chat => chat.fileId));
        filteredChats.forEach(chat => {
            let current = chat;
            while (current && current.parent) {
                const parentId = current.parent.id.replace('prompts/', '');
                if (finalNodesIdSet.has(parentId)) break;
                finalNodesIdSet.add(parentId);
                current = chatMap.get(parentId);
            }
        });
        return state.fullChatData.filter(chat => finalNodesIdSet.has(chat.fileId));
    }

    // --- Rendering Logic ---

    /**
     * @description Updates the graph nodes and edges based on the filtered data.
     * @param {Array<object>} dataToRender - The final array of data to display.
    */
    function renderGraph(dataToRender) {
        const activeNodeIds = new Set(dataToRender.map(c => c.fileId));
        const newNodes = [];
        const newEdges = [];

        dataToRender.forEach(chat => {
            const nodeObject = {
                id: chat.fileId,
                label: chat.fileName.replace('.txt', ''),
                color: state.favoriteIds.has(chat.fileId) ? '#FFD700' : '#97C2FC'
            };
            if (chat.description) nodeObject.title = chat.description;
            newNodes.push(nodeObject);

            if (chat.parent) {
                const parentId = chat.parent.id.replace('prompts/', '');
                if (activeNodeIds.has(parentId)) {
                    newEdges.push({
                        id: `${parentId}->${chat.fileId}`,
                        from: parentId,
                        to: chat.fileId,
                        arrows: "to"
                    });
                }
            }
        });

        state.nodesDataSet.clear();
        state.edgesDataSet.clear();
        state.nodesDataSet.add(newNodes);
        state.edgesDataSet.add(newEdges);
    }

    /**
     * @description Updates the "Showing X of Y" text counter.
     * @param {number} visibleCount - The number of visible chats.
    */
    function updateChatCounter(visibleCount) {
        DOM.chatCounter.innerText = `Showing: ${visibleCount} of ${state.fullChatData.length}`;
    }

    /**
     * @description Manages the graph camera's focus.
     * @param {boolean} shouldRefocus - Whether to perform the focus action.
     * @param {Array<object>} finalData - The filtered data used to find a focus target.
    */
    function handleFocus(shouldRefocus, finalData) {
        if (state.isFirstDraw && state.focusNodeId) {
            // The setTimeout(..., 0) trick defers the focus execution until the browser
            // has finished the current rendering cycle, ensuring the node exists.
            setTimeout(() => {
                if (state.nodesDataSet.get(state.focusNodeId)) {
                    state.network.focus(state.focusNodeId, { scale: 1.0, animation: false });
                }
            }, 0);
            state.isFirstDraw = false;
        } else if (shouldRefocus && !state.isFirstDraw && finalData.length > 0) {
            const newFocusTarget = finalData.find(chat =>
                !chat.parent || !new Set(finalData.map(c => c.fileId)).has(chat.parent.id.replace('prompts/', ''))
            );
            if (newFocusTarget) {
                state.network.focus(newFocusTarget.fileId, {
                    scale: 1.0,
                    animation: { duration: 800, easingFunction: 'easeInOutQuad' }
                });
            }
        }
    }

    // --- Event Handlers ---

    /**
     * @description Saves current filter inputs to localStorage.
    */
    function saveFiltersToLocalStorage() {
        try {
            const filters = {
                searchText: DOM.searchInput.value,
                tag: DOM.tagFilterSelect.value,
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
     * @description Restores filter inputs from localStorage.
    */
    function loadFiltersFromLocalStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const filters = JSON.parse(raw);
            if (typeof filters.searchText === 'string') DOM.searchInput.value = filters.searchText;
            if (typeof filters.tag === 'string') DOM.tagFilterSelect.value = filters.tag;
            if (typeof filters.showFavorites === 'boolean') DOM.favoritesFilterCheckbox.checked = filters.showFavorites;
            if (typeof filters.showHasBranches === 'boolean') DOM.branchesFilterCheckbox.checked = filters.showHasBranches;
            if (typeof filters.startDate === 'string') DOM.startDateInput.value = filters.startDate;
            if (typeof filters.endDate === 'string') DOM.endDateInput.value = filters.endDate;
        } catch (e) {
            console.warn('Could not load filters from localStorage:', e);
        }
    }

    /**
     * @description Resets all filters, clears localStorage, and refreshes the graph.
    */
    function clearFilters() {
        DOM.searchInput.value = '';
        DOM.tagFilterSelect.value = '';
        DOM.favoritesFilterCheckbox.checked = false;
        DOM.branchesFilterCheckbox.checked = false;
        DOM.startDateInput.value = '';
        DOM.endDateInput.value = '';
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            console.warn('Could not remove filters from localStorage:', e);
        }
        updateGraph(true);
    }

    /**
     * @description Handler for all filter controls. Uses debouncing to prevent
     * excessive graph redraws during text input.
    */
    function onFilterChange() {
        saveFiltersToLocalStorage();
        clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(() => updateGraph(true), DEBOUNCE_DELAY);
    }

    /**
     * @description Sets up all primary event listeners for the application.
    */
    function setupEventListeners() {
        Object.values(DOM).filter(el => el && el.id && el.id.startsWith('filter-'))
            .forEach(el => {
                el.addEventListener('input', onFilterChange);
                el.addEventListener('change', onFilterChange);
            });

        if (DOM.clearFiltersBtn) {
            DOM.clearFiltersBtn.addEventListener('click', clearFilters);
        }

        DOM.manageTagsBtn.addEventListener('click', openTagManager);
        DOM.closeModalBtn.addEventListener('click', () => DOM.tagManagerModal.classList.add('hidden'));
        DOM.newGlobalTagInput.addEventListener('keyup', handleNewGlobalTag);
        DOM.closeDescPanelBtn.addEventListener('click', () => DOM.descriptionPanel.classList.add('hidden'));
        DOM.favoriteStar.addEventListener('click', handleFavoriteToggle);
        DOM.addTagSelect.addEventListener('change', handleAddTagToChat);
        DOM.refreshDataBtn.addEventListener('click', handleRefreshClick);
    }

    /**
     * @async
     * @description Handles the creation of a new global tag from the modal.
     * @param {KeyboardEvent} event - The keyboard event.
    */
    async function handleNewGlobalTag(event) {
        if (event.key === 'Enter') {
            const newTag = event.target.value.trim().toLowerCase();
            if (newTag && !state.allTags.includes(newTag)) {
                state.allTags.push(newTag);
                state.allTags.sort();
                event.target.value = '';
                renderAllTagsList();
                const success = await saveAllTagsToServer();
                if (!success) {
                    state.allTags = state.allTags.filter(t => t !== newTag);
                    renderAllTagsList();
                }
            }
        }
    }

    /**
     * @async
     * @description Handles the star icon click for toggling a chat's favorite status.
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
        updateFavoriteStar(nodeId);
        state.nodesDataSet.update({ id: nodeId, color: state.favoriteIds.has(nodeId) ? '#FFD700' : '#97C2FC' });

        try {
            const response = await fetch(API.favorites, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Array.from(state.favoriteIds))
            });
            if (!response.ok) {
                throw new Error('Failed to save favorites to server.');
            }
            updateGraph(false);
        } catch (error) {
            if (wasFavorite) {
                state.favoriteIds.add(nodeId);
            } else {
                state.favoriteIds.delete(nodeId);
            }
            updateFavoriteStar(nodeId);
            state.nodesDataSet.update({ id: nodeId, color: wasFavorite ? '#FFD700' : '#97C2FC' });
            showNotification(error.message, 'error');
            console.error('Favorite toggle failed:', error);
        }
    }

    /**
     * @async
     * @description Handles tag selection from the dropdown in the description panel.
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
            renderTagsForChat(state.currentOpenChatId);

            const success = await saveTagsToServer();
            if (!success) {
                state.tagsData[state.currentOpenChatId] = state.tagsData[state.currentOpenChatId].filter(t => t !== newTag);
                renderTagsForChat(state.currentOpenChatId);
            }
        }
    }

    /**
     * @description Handles clicks on the graph (on a node or empty space).
     * @param {object} params - The click parameters from Vis.js.
    */
    function handleGraphClick(params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            state.currentOpenChatId = nodeId;
            const chatData = state.fullChatData.find(c => c.fileId === nodeId);
            if (!chatData) return;

            updateDescriptionPanel(chatData);
            DOM.descriptionPanel.classList.remove('hidden');
        } else {
            DOM.descriptionPanel.classList.add('hidden');
            state.currentOpenChatId = null;
        }
    }

    // --- Helper Functions ---

    /**
     * @description Opens the tag management modal.
    */
    function openTagManager() {
        renderAllTagsList();
        DOM.tagManagerModal.classList.remove('hidden');
    }

    /**
     * @description Renders the list of all tags in the modal.
    */
    function renderAllTagsList() {
        DOM.allTagsList.innerHTML = '';
        state.allTags.forEach(tag => {
            const tagEl = document.createElement('div');
            tagEl.className = 'tag-item';
            tagEl.innerText = tag;
            const removeBtn = document.createElement('span');
            removeBtn.className = 'remove-tag';
            removeBtn.innerText = '×';
            removeBtn.onclick = async () => {
                const prevAllTags = [...state.allTags];
                const prevTagsData = JSON.parse(JSON.stringify(state.tagsData));

                state.allTags = state.allTags.filter(t => t !== tag);
                for (const chatId in state.tagsData) {
                    state.tagsData[chatId] = state.tagsData[chatId].filter(t => t !== tag);
                }
                renderAllTagsList();

                const tagsOk = await saveTagsToServer();
                const allTagsOk = await saveAllTagsToServer();
                if (!tagsOk || !allTagsOk) {
                    state.allTags = prevAllTags;
                    state.tagsData = prevTagsData;
                    renderAllTagsList();
                }
            };
            tagEl.appendChild(removeBtn);
            DOM.allTagsList.appendChild(tagEl);
        });
    }

    /**
     * @description Renders the tags for a specific chat in the side panel.
     * @param {string} chatId - The ID of the chat.
    */
    function renderTagsForChat(chatId) {
        DOM.descTagsList.innerHTML = '';
        const tags = state.tagsData[chatId] || [];
        tags.forEach(tag => {
            const tagEl = document.createElement('span');
            tagEl.className = 'tag-item';
            tagEl.innerText = tag;
            const removeBtn = document.createElement('span');
            removeBtn.className = 'remove-tag';
            removeBtn.innerText = '×';
            removeBtn.onclick = async () => {
                const prevTags = [...(state.tagsData[chatId] || [])];
                state.tagsData[chatId] = state.tagsData[chatId].filter(t => t !== tag);
                renderTagsForChat(chatId);
                const success = await saveTagsToServer();
                if (!success) {
                    state.tagsData[chatId] = prevTags;
                    renderTagsForChat(chatId);
                }
            };
            tagEl.appendChild(removeBtn);
            DOM.descTagsList.appendChild(tagEl);
        });
    }

    /**
     * @description Populates the side panel with the full details of a selected chat.
     * @param {object} chatData - The chat data object.
    */
    function updateDescriptionPanel(chatData) {
        DOM.descTitle.replaceChildren();
        const titleLink = document.createElement('a');
        titleLink.href = `https://aistudio.google.com/prompts/${encodeURIComponent(chatData.fileId)}`;
        titleLink.target = '_blank';
        titleLink.rel = 'noopener noreferrer';
        titleLink.textContent = chatData.fileName;
        DOM.descTitle.appendChild(titleLink);

        DOM.descContent.innerText = chatData.description || 'No description provided.';
        DOM.createdDateEl.innerText = `Created: ${chatData.createdDate.split('T')[0]}`;
        DOM.modifiedDateEl.innerText = `Modified: ${chatData.modifiedDate.split('T')[0]}`;
        updateFavoriteStar(chatData.fileId);
        updateSourceFileLink(chatData);
        renderTagsForChat(chatData.fileId);
    }

    /**
     * @description Updates the star's appearance (empty/filled).
     * @param {string} nodeId - The ID of the node.
    */
    function updateFavoriteStar(nodeId) {
        const isFav = state.favoriteIds.has(nodeId);
        DOM.favoriteStar.classList.toggle('is-favorite', isFav);
        DOM.favoriteStar.innerText = isFav ? '★' : '☆';
    }

    /**
     * @description Builds and sets the "smart" link to the source file in Google Drive.
     * @param {object} chatData - The chat data object.
    */
    function updateSourceFileLink(chatData) {
        const encodedFileName = encodeURIComponent(`"${chatData.fileName}"`);
        let exclusionsString = ' -type:image -type:document -type:spreadsheet -type:pdf -type:presentation -type-drawing -type:form';
        
        // Dynamically create an exclusion for child branches to provide a cleaner search result.
        const branchDepth = (chatData.fileName.match(/Branch of /g) || []).length;
        if (branchDepth === 0) {
            exclusionsString += ` -"Branch of"`;
        } else {
            const nextLevelPrefix = "Branch of ".repeat(branchDepth + 1);
            exclusionsString += ` -"${nextLevelPrefix}"`;
        }
        const encodedExclusions = encodeURIComponent(exclusionsString);
        DOM.sourceFileLink.href = `https://drive.google.com/drive/search?q=${encodedFileName}${encodedExclusions}`;
    }

    /**
     * @async
     * @description Saves the global list of tags to the server and updates the UI.
    */
    async function saveAllTagsToServer() {
        try {
            const response = await fetch(API.allTags, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state.allTags)
            });
            if (!response.ok) {
                throw new Error('Failed to save tags to server.');
            }
            populateTagFilter();
            populateTagAddSelect();
            return true;
        } catch (error) {
            showNotification(error.message, 'error');
            console.error('Save all tags error:', error);
            return false;
        }
    }

    /**
     * @async
     * @description Saves the tag assignments for chats to the server and updates the graph.
    */
    async function saveTagsToServer() {
        try {
            const response = await fetch(API.tags, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state.tagsData)
            });
            if (!response.ok) {
                throw new Error('Failed to save chat tags to server.');
            }
            updateGraph(false);
            return true;
        } catch (error) {
            showNotification(error.message, 'error');
            console.error('Save tags error:', error);
            return false;
        }
    }

    /**
     * @description Populates the tag filter dropdown.
    */
    function populateTagFilter() {
        const currentValue = DOM.tagFilterSelect.value;
        DOM.tagFilterSelect.innerHTML = '<option value="">All Tags</option>';
        state.allTags.forEach(tag => {
            const option = document.createElement('option');
            option.value = tag;
            option.innerText = tag;
            DOM.tagFilterSelect.appendChild(option);
        });
        DOM.tagFilterSelect.value = currentValue;
    }

    /**
     * @description Populates the tag selection dropdown in the description panel.
    */
    function populateTagAddSelect() {
        DOM.addTagSelect.innerHTML = '<option value="">-- Select a tag to add --</option>';
        state.allTags.forEach(tag => {
            const option = document.createElement('option');
            option.value = tag;
            option.innerText = tag;
            DOM.addTagSelect.appendChild(option);
        });
    }
    
    // --- Application Start ---
    document.addEventListener('DOMContentLoaded', initialize);

})();