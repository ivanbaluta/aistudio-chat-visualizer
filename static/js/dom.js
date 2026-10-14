/**
 * @file Cached DOM element references.
 */

export const DOM = {
    loadingLabel: document.getElementById("loading"),
    networkContainer: document.getElementById("mynetwork"),
    searchInput: document.getElementById('filter-search'),
    filterTagsList: document.getElementById('filter-tags-list'),
    tagModeOrBtn: document.getElementById('tag-mode-or'),
    tagModeAndBtn: document.getElementById('tag-mode-and'),
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
