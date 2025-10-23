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

    // --- Constants & Configuration ---
    const API = {
        favorites: '/api/favorites',
        tags: '/api/tags',
        allTags: '/api/all-tags',
        chatData: 'chat_data.json'
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
        notificationBar: document.getElementById('notification-bar')
    };
    const DEBOUNCE_DELAY = 300; // Delay in ms for debouncing user input.

    // --- Core Logic ---

    /**
     * @async
     * @description Loads all data and completely redraws the graph.
    */
    async function loadAndRender() {
        state.isFirstDraw = true;
        DOM.loadingLabel.style.display = 'block';
        DOM.networkContainer.style.display = 'none';

        await loadInitialData();
        populateUI();
        if (!state.network) {
            createNetworkGraph();
            setupEventListeners();
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
        try {
            await loadAndRender();
        } catch (error) {
            DOM.loadingLabel.innerText = "Error! Failed to load or process data.";
            console.error("Initialization Error:", error);
        }
    }

    /**
     * @description Displays a notification for a few seconds.
     * @param {string} message
     * @param {'success' | 'error'} type
    */
    function showNotification(message, type) {
        DOM.notificationBar.textContent = message;
        DOM.notificationBar.className = type; // 'success' or 'error'
        
        setTimeout(() => {
            DOM.notificationBar.className = 'hidden';
        }, 5000);
    }

    /**
     * @async
     * @description Handler for the data refresh button.
    */
    async function handleRefreshClick() {
        DOM.refreshDataBtn.disabled = true;
        DOM.refreshSpinner.classList.remove('hidden');
        showNotification('Fetching latest data from Google Drive... This may take a moment.', 'success');

        try {
            const response = await fetch('/api/refresh-data', { method: 'POST' });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to refresh data.');
            }

            showNotification('Data updated! Reloading graph...', 'success');
            
            await loadAndRender();

        } catch (error) {
            console.error('Refresh failed:', error);
            showNotification(error.message, 'error');
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
        // Using Promise.all allows all network requests to run concurrently, speeding up the initial load.
        const [favRes, tagsRes, allTagsRes, chatRes] = await Promise.all([
            fetch(API.favorites), fetch(API.tags), fetch(API.allTags), fetch(API.chatData)
        ]);
        state.favoriteIds = new Set(await favRes.json());
        state.tagsData = await tagsRes.json();
        state.allTags = await allTagsRes.json();
        const dataFromFile = await chatRes.json();
        state.fullChatData = dataFromFile.chats;

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
     * @description Clears and redraws the graph's nodes and edges based on the filtered data.
     * @param {Array<object>} dataToRender - The final array of data to display.
    */
    function renderGraph(dataToRender) {
        const newNodes = [];
        const newEdges = [];
        const nodesInGraph = new Set(dataToRender.map(c => c.fileId));

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
                if (nodesInGraph.has(parentId)) {
                    newEdges.push({ from: parentId, to: chat.fileId, arrows: "to" });
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
     * @description Handler for all filter controls. Uses debouncing to prevent
     * excessive graph redraws during text input.
    */
    function onFilterChange() {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(() => updateGraph(true), DEBOUNCE_DELAY);
    }

    /**
     * @description Sets up all primary event listeners for the application.
    */
    function setupEventListeners() {
        // Efficiently assign a single handler to all filter inputs.
        Object.values(DOM).filter(el => el.id && el.id.startsWith('filter-'))
            .forEach(el => el.addEventListener('input', onFilterChange));

        DOM.manageTagsBtn.addEventListener('click', openTagManager);
        DOM.closeModalBtn.addEventListener('click', () => DOM.tagManagerModal.classList.add('hidden'));
        DOM.newGlobalTagInput.addEventListener('keyup', handleNewGlobalTag);
        DOM.closeDescPanelBtn.addEventListener('click', () => DOM.descriptionPanel.classList.add('hidden'));
        DOM.favoriteStar.addEventListener('click', handleFavoriteToggle);
        DOM.addTagSelect.addEventListener('change', handleAddTagToChat);
        state.network.on("click", handleGraphClick);
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
                await saveAllTagsToServer();
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
        if (state.favoriteIds.has(nodeId)) {
            state.favoriteIds.delete(nodeId);
        } else {
            state.favoriteIds.add(nodeId);
        }
        updateFavoriteStar(nodeId);
        state.nodesDataSet.update({ id: nodeId, color: state.favoriteIds.has(nodeId) ? '#FFD700' : '#97C2FC' });
        await fetch(API.favorites, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Array.from(state.favoriteIds))
        });
        updateGraph(false);
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
            await saveTagsToServer();
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
                state.allTags = state.allTags.filter(t => t !== tag);
                for (const chatId in state.tagsData) {
                    state.tagsData[chatId] = state.tagsData[chatId].filter(t => t !== tag);
                }
                await saveTagsToServer(); // Save the updated chat-tag assignments
                renderAllTagsList();
                await saveAllTagsToServer(); // Save the updated global tag list
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
                state.tagsData[chatId] = state.tagsData[chatId].filter(t => t !== tag);
                renderTagsForChat(chatId);
                await saveTagsToServer();
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
        DOM.descTitle.innerHTML = `<a href="https://aistudio.google.com/prompts/${chatData.fileId}" target="_blank">${chatData.fileName}</a>`;
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
        await fetch(API.allTags, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.allTags) });
        populateTagFilter();
        populateTagAddSelect();
    }

    /**
     * @async
     * @description Saves the tag assignments for chats to the server and updates the graph.
    */
    async function saveTagsToServer() {
        await fetch(API.tags, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.tagsData) });
        updateGraph(false);
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