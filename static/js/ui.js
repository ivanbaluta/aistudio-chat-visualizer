/**
 * @file UI component rendering, modal dialogs, and notifications.
 */

import { state } from './state.js';
import { DOM } from './dom.js';
import { saveAllTagsToServer, saveTagsToServer } from './api.js';

let notificationTimeout = null;

/**
 * Displays a floating notification banner to the user.
 * @param {string} message
 * @param {'success' | 'error'} type
 * @param {number} [duration=5000]
 */
export function showNotification(message, type, duration = 5000) {
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
    }

    DOM.notificationBar.textContent = message;
    DOM.notificationBar.className = type;

    if (duration > 0) {
        notificationTimeout = setTimeout(() => {
            DOM.notificationBar.className = 'hidden';
            notificationTimeout = null;
        }, duration);
    }
}

/**
 * Renders tag filter chips in the sidebar filter section.
 * @param {Function} [onFilterChange]
 */
export function populateTagFilter(onFilterChange) {
    if (!DOM.filterTagsList) return;
    DOM.filterTagsList.innerHTML = '';

    if (state.allTags.length === 0) {
        const emptyMsg = document.createElement('span');
        emptyMsg.className = 'filter-tags-empty';
        emptyMsg.innerText = 'No tags available';
        DOM.filterTagsList.appendChild(emptyMsg);
        return;
    }

    state.allTags.forEach(tag => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'filter-tag-chip';
        chip.textContent = tag;
        chip.dataset.tag = tag;
        if (state.selectedTags.has(tag)) {
            chip.classList.add('active');
        }

        chip.addEventListener('click', () => {
            if (state.selectedTags.has(tag)) {
                state.selectedTags.delete(tag);
                chip.classList.remove('active');
            } else {
                state.selectedTags.add(tag);
                chip.classList.add('active');
            }
            if (onFilterChange) onFilterChange();
        });

        DOM.filterTagsList.appendChild(chip);
    });
}

/**
 * Populates the dropdown select for adding tags in the details panel.
 */
export function populateTagAddSelect() {
    DOM.addTagSelect.innerHTML = '<option value="">-- Select a tag to add --</option>';
    state.allTags.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag;
        option.innerText = tag;
        DOM.addTagSelect.appendChild(option);
    });
}

/**
 * Updates star icon filled/empty appearance for a chat ID.
 * @param {string} nodeId
 */
export function updateFavoriteStar(nodeId) {
    const isFav = state.favoriteIds.has(nodeId);
    DOM.favoriteStar.classList.toggle('is-favorite', isFav);
    DOM.favoriteStar.innerText = isFav ? '★' : '☆';
}

/**
 * Generates and sets a scoped Google Drive search URL for the chat file.
 * @param {object} chatData
 */
export function updateSourceFileLink(chatData) {
    const sanitizedName = chatData.fileName.replace(/"/g, '');
    const queryParts = [`title:"${sanitizedName}"`];

    if (chatData.createdDate) {
        const created = new Date(chatData.createdDate);
        if (!isNaN(created.getTime())) {
            const pad = (n) => String(n).padStart(2, '0');
            const formatDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
            const afterBound = new Date(created.getTime() - 24 * 60 * 60 * 1000);
            const beforeBound = new Date(created.getTime() + 2 * 24 * 60 * 60 * 1000);
            queryParts.push(`createdafter:${formatDate(afterBound)}`);
            queryParts.push(`createdbefore:${formatDate(beforeBound)}`);
        }
    }

    let exclusions = '-type:image -type:document -type:spreadsheet -type:pdf -type:presentation -type:drawing -type:form -type:folder';
    const branchDepth = (chatData.fileName.match(/Branch of /g) ?? []).length;
    if (branchDepth === 0) {
        exclusions += ' -"Branch of"';
    } else {
        const nextLevelPrefix = "Branch of ".repeat(branchDepth + 1);
        exclusions += ` -"${nextLevelPrefix}"`;
    }
    queryParts.push(exclusions);

    DOM.sourceFileLink.href = `https://drive.google.com/drive/search?q=${encodeURIComponent(queryParts.join(' '))}`;
}

/**
 * Renders tag chips for a single chat in the details panel.
 * @param {string} chatId
 * @param {Function} [onTagsChanged]
 */
export function renderTagsForChat(chatId, onTagsChanged) {
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
            renderTagsForChat(chatId, onTagsChanged);
            try {
                await saveTagsToServer(state.tagsData);
                if (onTagsChanged) onTagsChanged();
            } catch (err) {
                state.tagsData[chatId] = prevTags;
                renderTagsForChat(chatId, onTagsChanged);
                showNotification(err.message, 'error');
            }
        };
        tagEl.appendChild(removeBtn);
        DOM.descTagsList.appendChild(tagEl);
    });
}

/**
 * Fills details panel with metadata of the selected chat.
 * @param {object} chatData
 * @param {Function} [onTagsChanged]
 */
export function updateDescriptionPanel(chatData, onTagsChanged) {
    DOM.descTitle.replaceChildren();
    const titleLink = document.createElement('a');
    titleLink.href = `https://aistudio.google.com/prompts/${encodeURIComponent(chatData.fileId)}`;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = chatData.fileName;
    DOM.descTitle.appendChild(titleLink);

    DOM.descContent.innerText = chatData.description || 'No description provided.';
    DOM.createdDateEl.innerText = `Created: ${chatData.createdDate?.split('T')[0] ?? 'Unknown'}`;
    DOM.modifiedDateEl.innerText = `Modified: ${chatData.modifiedDate?.split('T')[0] ?? 'Unknown'}`;
    updateFavoriteStar(chatData.fileId);
    updateSourceFileLink(chatData);
    renderTagsForChat(chatData.fileId, onTagsChanged);
}

/**
 * Opens global tag management modal dialog.
 * @param {Function} [onTagDeleted]
 */
export function openTagManager(onTagDeleted) {
    renderAllTagsList(onTagDeleted);
    DOM.tagManagerModal.classList.remove('hidden');
}

/**
 * Renders the global list of tags in the tag manager modal.
 * @param {Function} [onTagDeleted]
 */
export function renderAllTagsList(onTagDeleted) {
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
            const prevTagsData = structuredClone(state.tagsData);
            const wasSelected = state.selectedTags.has(tag);

            state.allTags = state.allTags.filter(t => t !== tag);
            state.selectedTags.delete(tag);
            for (const chatId in state.tagsData) {
                state.tagsData[chatId] = state.tagsData[chatId].filter(t => t !== tag);
            }
            renderAllTagsList(onTagDeleted);
            populateTagFilter(onTagDeleted);
            populateTagAddSelect();
            if (wasSelected && onTagDeleted) onTagDeleted();

            try {
                await Promise.all([
                    saveTagsToServer(state.tagsData),
                    saveAllTagsToServer(state.allTags)
                ]);
            } catch (err) {
                state.allTags = prevAllTags;
                state.tagsData = prevTagsData;
                if (wasSelected) state.selectedTags.add(tag);
                renderAllTagsList(onTagDeleted);
                populateTagFilter(onTagDeleted);
                populateTagAddSelect();
                if (wasSelected && onTagDeleted) onTagDeleted();
                showNotification(err.message, 'error');
            }
        };
        tagEl.appendChild(removeBtn);
        DOM.allTagsList.appendChild(tagEl);
    });
}
