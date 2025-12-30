
function updateActivePage(pageId, albumId) {
    if (state.activeAlbumId !== albumId) {
        state.activeAlbumId = albumId;
        state.activePageId = pageId;
        renderSidebar();
        renderCanvas().then(() => {
            // After re-rendering (switching album), flip to the specific page
            const pages = getAlbumPages();
            const index = pages.findIndex(p => p.id === pageId);
            if (index >= 0 && pageFlip) {
                // Short timeout to ensure pageFlip is ready
                setTimeout(() => pageFlip.flip(index), 100);
            }
        });
        return;
    }

    state.activePageId = pageId;
    renderSidebar();

    if (pageFlip) {
        const pages = getAlbumPages();
        const index = pages.findIndex(p => p.id === pageId);
        if (index >= 0) {
            pageFlip.flip(index);
        }
    }
}
