// Initialize Page-Flip.js
function initPageFlip() {
    if (!bookEl) return;

    // Responsive configuration
    const isMobile = window.innerWidth < 900;

    // Dimensions for mobile vs desktop
    // Mobile usually needs single page view which is "portrait" in this library context usually, 
    // or just constrained width.
    const width = isMobile ? window.innerWidth - 20 : 550;
    const height = isMobile ? window.innerHeight * 0.7 : 733;

    try {
        pageFlip = new St.PageFlip(bookEl, {
            width: width,
            height: height,
            size: isMobile ? 'fixed' : 'stretch',
            minWidth: 315,
            maxWidth: 1000,
            minHeight: 420,
            maxHeight: 1350,
            showCover: true,
            mobileScrollSupport: false, // keep false effectively to prevent conflicts
            swipeDistance: 30,
            clickEventForward: true,
            usePortrait: isMobile // Force single page on mobile
        });

        pageFlip.on('flip', (e) => {
            playFlipSound();
            updatePageInfo();
        });

        pageFlip.on('changeState', (e) => {
            updateNavigationButtons();
        });
    } catch (error) {
        console.error('Failed to initialize PageFlip:', error);
    }
}

// Window Resize Handler to re-init if orientation changes significantly
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Only re-render if we need to switch modes (e.g. desktop <-> mobile width crossed)
        // For simplicity, we can just re-render canvas which re-inits flipbook
        console.log('Resize detected, re-rendering book...');
        renderCanvas();
    }, 500);
});

// Update page info display
function updatePageInfo() {
    if (!pageFlip || !pageInfoEl) return;
    const current = pageFlip.getCurrentPageIndex();
    const total = pageFlip.getPageCount();
    pageInfoEl.textContent = `Page ${current + 1} of ${total}`;
}

// Update navigation button states
function updateNavigationButtons() {
    if (!pageFlip) return;
    const current = pageFlip.getCurrentPageIndex();
    const total = pageFlip.getPageCount();

    if (prevBtn) {
        prevBtn.disabled = current <= 0;
    }
    if (nextBtn) {
        nextBtn.disabled = current >= total - 1;
    }
}

async function renderCanvas() {
    await flushPendingSaves();

    const pages = getAlbumPages();

    if (!bookEl) {
        console.warn('bookEl not found');
        return;
    }

    bookEl.innerHTML = '';

    if (!pages || pages.length === 0) {
        bookEl.innerHTML = `
            <div class="empty-state">
                <p class="empty-eyebrow">No pages available</p>
                <h1>Create your first page</h1>
                <p>Use the album sidebar to add pages.</p>
            </div>
        `;
        if (pageInfoEl) pageInfoEl.textContent = '';
        return;
    }

    // Create page elements for page-flip.js
    pages.forEach((page, index) => {
        const pageDiv = document.createElement('div');
        pageDiv.className = 'page';
        pageDiv.dataset.pageId = page.id;
        pageDiv.dataset.density = index === 0 ? 'hard' : 'soft';

        // Render page content directly
        renderPageContent(pageDiv, page);

        bookEl.appendChild(pageDiv);
    });

    // Destroy old instance if exists
    if (pageFlip) {
        try {
            pageFlip.destroy();
        } catch (e) {
            console.warn('Error destroying pageFlip:', e);
        }
        pageFlip = null;
    }

    // Initialize page-flip.js
    initPageFlip();

    if (pageFlip) {
        try {
            const pageElements = document.querySelectorAll('.page');
            console.log(`Loading ${pageElements.length} pages into PageFlip`);
            pageFlip.loadFromHTML(pageElements);
            updatePageInfo();
            updateNavigationButtons();
        } catch (error) {
            console.error('Error loading pages:', error);
        }
    }
}

// Render page content (blocks)
function renderPageContent(container, page) {
    if (!page.content || !Array.isArray(page.content)) return;

    page.content.forEach(block => {
        const blockEl = document.createElement('div');
        blockEl.className = 'page-block';
        blockEl.dataset.blockId = block.id;

        if (block.type === 'photo') {
            blockEl.classList.add('page-block--photo');
            const img = document.createElement('img');
            img.src = block.value;
            img.alt = 'Photo';
            blockEl.appendChild(img);
        } else if (block.type === 'text') {
            blockEl.classList.add('page-block--text');
            const textEl = document.createElement('div');

            // Handle both string and object format
            let textContent = '';
            let fontFamily = 'Outfit';
            if (typeof block.value === 'string') {
                textContent = block.value;
            } else if (block.value && typeof block.value === 'object') {
                textContent = block.value.text || '';
                fontFamily = block.value.fontFamily || 'Outfit';
            }

            textEl.textContent = textContent;
            textEl.style.fontFamily = fontFamily;
            textEl.style.fontSize = (block.fontSize || 16) + 'px';
            blockEl.appendChild(textEl);
        } else if (block.type === 'sticker') {
            blockEl.classList.add('page-block--sticker');
            if (block.value && block.value.startsWith('data:image')) {
                const img = document.createElement('img');
                img.src = block.value;
                img.alt = 'Sticker';
                blockEl.appendChild(img);
            } else {
                blockEl.textContent = block.value || '⭐';
            }
        }

        // Apply styles
        applyBlockStyles(blockEl, block);

        // Add actions
        const actions = document.createElement('div');
        actions.className = 'block-actions';

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '×';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeBlock(page.id, block.id);
        });

        actions.appendChild(deleteBtn);
        blockEl.appendChild(actions);

        // Add resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'block-resize-handle';
        blockEl.appendChild(resizeHandle);

        // Enable drag and resize
        enableBlockDrag(blockEl, block, container, page);
        enableBlockResize(blockEl, block, container, page, resizeHandle);

        container.appendChild(blockEl);
    });
}
