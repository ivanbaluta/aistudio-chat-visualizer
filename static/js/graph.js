/**
 * @file Vis.js graph lifecycle, rendering, and camera focus logic.
 */

import { state } from './state.js';
import { DOM } from './dom.js';

/**
 * Initializes Vis.js DataSets for nodes and edges.
 */
export function initGraphDatasets() {
    const visLib = typeof window !== 'undefined' ? window.vis : null;
    if (!visLib) return;
    if (!state.nodesDataSet) {
        state.nodesDataSet = new visLib.DataSet([]);
    }
    if (!state.edgesDataSet) {
        state.edgesDataSet = new visLib.DataSet([]);
    }
}

/**
 * Creates and mounts an instance of the Vis.js network graph.
 * @param {Function} onGraphClick - Click event handler callback.
 */
export function createNetworkGraph(onGraphClick) {
    initGraphDatasets();
    const visLib = window.vis;
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
    state.network = new visLib.Network(DOM.networkContainer, data, options);
    state.network.on("click", onGraphClick);
}

/**
 * Updates graph nodes and edges to match the filtered dataset.
 * @param {Array<object>} dataToRender
 */
export function renderGraph(dataToRender) {
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
 * Updates the visible chat counter text.
 * @param {number} visibleCount
 * @param {number} totalCount
 */
export function updateChatCounter(visibleCount, totalCount) {
    DOM.chatCounter.innerText = `Showing: ${visibleCount} of ${totalCount}`;
}

/**
 * Manages initial camera positioning and refocusing on filtered subsets.
 * @param {boolean} shouldRefocus
 * @param {Array<object>} finalData
 */
export function handleFocus(shouldRefocus, finalData) {
    if (state.isFirstDraw && state.focusNodeId) {
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
