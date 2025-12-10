// DOM Elements for new flip book structure
const albumListEl = document.getElementById('album-list');
const albumSidebar = document.getElementById('album-sidebar');
const toggleAlbumsBtn = document.getElementById('toggle-albums-btn');
const bookEl = document.getElementById('book');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const pageInfoEl = document.getElementById('page-info');
const newAlbumBtn = document.getElementById('create-album-btn');
const addTextBtn = document.getElementById('add-text-btn');
const addStickerBtn = document.getElementById('add-sticker-btn');
const addPhotoBtn = document.getElementById('add-photo-btn');
const photoInput = document.getElementById('photo-input');
const stickerInput = document.getElementById('sticker-input');
const fontInput = document.getElementById('font-input');
const modalEl = document.getElementById('modal');
const modalTitleEl = document.getElementById('modal-title');
const modalBodyEl = document.getElementById('modal-body');
const modalCloseBtn = document.getElementById('modal-close');
const modalCancelBtn = document.getElementById('modal-cancel');
const modalConfirmBtn = document.getElementById('modal-confirm');

// Page-Flip.js instance
let pageFlip = null;

const state = {
    albums: [],
    pages: [],
    activeAlbumId: null,
    activePageId: null,
    sidebarMode: 'albums'
};

const saveTimers = new Map();
let contextTargetPageId = null;

const EDGE_DRAG_ZONE = 150;
const FLIP_DRAG_THRESHOLD = 50;
const STICKER_LIBRARY = [];
let CUSTOM_STICKERS = JSON.parse(localStorage.getItem('custom_stickers') || '[]');
let CUSTOM_PHOTOS = JSON.parse(localStorage.getItem('custom_photos') || '[]');
let CUSTOM_FONTS = JSON.parse(localStorage.getItem('custom_fonts') || '[]');

const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let modalConfirmHandler = null;
let dragState = null;
let blockZCounter = 10;

const API_BASE = '/api';

async function apiRequest(path, options = {}) {
    const init = {
        credentials: 'same-origin',
        ...options
    };
    init.headers = {
        Accept: 'application/json',
        ...(options.headers || {})
    };
    if (init.body && typeof init.body !== 'string') {
        init.body = JSON.stringify(init.body);
    }
    if (init.body && !init.headers['Content-Type']) {
        init.headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${API_BASE}${path}`, init);
    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            console.warn('Failed to parse API response as JSON', error);
        }
    }

    if (!response.ok) {
        const message = data?.error || data?.message || text || `Request failed with status ${response.status}`;
        throw new Error(message);
    }

    return data;
}

function normalizePage(page) {
    if (!page) return null;
    const normalized = {
        ...page,
        albumId: page.albumId ?? page.album_id ?? null,
        position: typeof page.position === 'number' ? page.position : 0,
        content: Array.isArray(page.content) ? page.content : []
    };
    delete normalized.album_id;
    return normalized;
}

function normalizeAlbum(album) {
    if (!album) return null;
    const pages = Array.isArray(album.pages)
        ? album.pages.map(normalizePage).filter(Boolean).sort((a, b) => a.position - b.position)
        : [];
    return {
        ...album,
        id: album.id,
        title: album.title || 'Untitled Album',
        position: typeof album.position === 'number' ? album.position : 0,
        pages
    };
}

const flipAudioTemplate = new Audio('./assets/page-flip.mp3');
flipAudioTemplate.preload = 'auto';
flipAudioTemplate.volume = 0.35;

function playFlipSound() {
    try {
        const instance = flipAudioTemplate.cloneNode();
        instance.volume = flipAudioTemplate.volume;
        instance.play().catch(() => { });
    } catch {
        flipAudioTemplate.currentTime = 0;
        flipAudioTemplate.play().catch(() => { });
    }
}

// Attach event listeners
function attachEvents() {
    // Toggle album sidebar
    if (toggleAlbumsBtn) {
        toggleAlbumsBtn.addEventListener('click', () => {
            albumSidebar.classList.toggle('hidden');
        });
    }

    // Navigation buttons for flip book
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (pageFlip) pageFlip.flipPrev();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (pageFlip) pageFlip.flipNext();
        });
    }

    // Content addition buttons
    addStickerBtn.addEventListener('click', () => {
        state.sidebarMode = 'stickers';
        renderSidebar();
        if (albumSidebar.classList.contains('hidden')) {
            albumSidebar.classList.remove('hidden');
        }
    });

    // Fix: Add Text Button Listener
    addTextBtn.addEventListener('click', () => {
        showAddTextModal();
    });

    addPhotoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('Toolbar: Photo button clicked');
        state.sidebarMode = 'photos';
        try {
            if (albumSidebar.classList.contains('hidden')) {
                albumSidebar.classList.remove('hidden');
            }
            renderSidebar();
        } catch (e) {
            console.error('Error rendering photo sidebar:', e);
        }
    });

    photoInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // 1. Read file
        const reader = new FileReader();
        reader.onload = async () => {
            let dataUrl = reader.result;

            // 2. Resize/Compress to save space (max 800px, 0.7 quality)
            try {
                dataUrl = await resizeImage(dataUrl, 800, 0.7);
            } catch (err) {
                console.warn('Image resize failed, using original', err);
            }

            // 3. Update State - Add to beginning
            CUSTOM_PHOTOS.unshift(dataUrl);

            // 4. Try to save to LocalStorage
            try {
                localStorage.setItem('custom_photos', JSON.stringify(CUSTOM_PHOTOS));
            } catch (e) {
                console.error('Storage full:', e);
                // Remove the item we just added since we can't save it
                CUSTOM_PHOTOS.shift();
                alert('Storage is full! Could not save photo to sidebar permanently. Try deleting some old items.');
                return;
            }

            // 5. Render
            state.sidebarMode = 'photos';
            renderSidebar();
            if (albumSidebar.classList.contains('hidden')) {
                albumSidebar.classList.remove('hidden');
            }
        };
        reader.readAsDataURL(file);
        photoInput.value = '';
    });

    stickerInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            CUSTOM_STICKERS.unshift(dataUrl);
            localStorage.setItem('custom_stickers', JSON.stringify(CUSTOM_STICKERS));

            // If sidebar is showing stickers, refresh it
            if (state.sidebarMode === 'stickers') {
                renderSidebar();
            } else {
                // If not in sticker mode, maybe switch to it?
                state.sidebarMode = 'stickers';
                renderSidebar();
                if (albumSidebar.classList.contains('hidden')) {
                    albumSidebar.classList.remove('hidden');
                }
            }
        };
        reader.readAsDataURL(file);
        stickerInput.value = '';
    });



    fontInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        console.log(`Font upload started. Name: ${file.name}, Type: ${file.type}, Size: ${file.size}`);

        const reader = new FileReader();
        reader.onload = async () => {
            const fontName = file.name.split('.')[0];
            const fontData = reader.result; // Data URL

            try {
                // Validate data URL
                if (!fontData.startsWith('data:')) {
                    throw new Error('Invalid font data format.');
                }

                console.log(`Attempting to load font: ${fontName}`);
                const fontFace = new FontFace(fontName, `url(${fontData})`);

                await fontFace.load();
                console.log('FontFace loaded successfully');

                document.fonts.add(fontFace);
                console.log('Font added to document');

                CUSTOM_FONTS.push({ name: fontName, data: fontData });
                try {
                    localStorage.setItem('custom_fonts', JSON.stringify(CUSTOM_FONTS));
                } catch (storageError) {
                    console.error('LocalStorage failed (likely full):', storageError);
                    alert('Font loaded but could not be saved permanently (Storage Full).');
                }

                alert(`Font "${fontName}" added!`);
            } catch (e) {
                console.error('Font load error details:', e);
                alert(`Failed to load font: ${e.message}`);
            }
        };
        reader.onerror = (err) => {
            console.error('FileReader error:', err);
            alert('Error reading file.');
        };
        reader.readAsDataURL(file);
        fontInput.value = '';
    });

    // Modal event listeners
    modalCloseBtn.addEventListener('click', closeModal);
    modalCancelBtn.addEventListener('click', closeModal);
    modalConfirmBtn.addEventListener('click', () => {
        if (typeof modalConfirmHandler === 'function') {
            modalConfirmHandler();
        }
    });
}
// ... (rest of code) ...

function renderSidebar() {
    console.log('Rendering sidebar, mode:', state.sidebarMode);

    // Clear sidebar content
    albumListEl.innerHTML = '';

    // 1. Create Tabs Container
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'sidebar-tabs';
    tabsContainer.style.display = 'flex';
    tabsContainer.style.borderBottom = '1px solid #ddd';
    tabsContainer.style.marginBottom = '1rem';

    // Helper to create tab
    const createTab = (id, label, icon) => {
        const btn = document.createElement('button');
        btn.className = `sidebar-tab ${state.sidebarMode === id ? 'active' : ''}`;
        btn.style.flex = '1';
        btn.style.padding = '10px 5px';
        btn.style.background = 'none';
        btn.style.border = 'none';
        btn.style.borderBottom = state.sidebarMode === id ? '2px solid #333' : '2px solid transparent';
        btn.style.cursor = 'pointer';
        btn.style.fontWeight = state.sidebarMode === id ? 'bold' : 'normal';
        btn.title = label;
        btn.innerText = label;

        btn.onclick = () => {
            state.sidebarMode = id;
            renderSidebar();
        };
        return btn;
    };

    tabsContainer.appendChild(createTab('albums', 'Albums'));
    tabsContainer.appendChild(createTab('stickers', 'Stickers'));
    tabsContainer.appendChild(createTab('photos', 'Photos'));

    albumListEl.appendChild(tabsContainer);

    // 2. Create Content Container
    const contentContainer = document.createElement('div');
    contentContainer.className = 'sidebar-content';
    contentContainer.style.flex = '1';
    contentContainer.style.overflowY = 'auto';
    albumListEl.appendChild(contentContainer);

    // 3. Render Content based on mode
    if (state.sidebarMode === 'stickers') {
        renderStickerContent(contentContainer);
    } else if (state.sidebarMode === 'photos') {
        try {
            renderPhotoContent(contentContainer);
        } catch (e) {
            console.error('Error in renderPhotoSidebar:', e);
            contentContainer.innerHTML = '<p class="error">Error loading photos.</p>';
        }
    } else {
        renderAlbumListContent(contentContainer);
    }
}

// Renamed from renderAlbumList to avoid conflicts/recursion
function renderAlbumListContent(container) {
    // Add "Create Album" button at the top
    const createBtnContainer = document.createElement('div');
    createBtnContainer.style.padding = '0 0 1rem 0';
    createBtnContainer.style.textAlign = 'center';

    const createBtn = document.createElement('button');
    createBtn.className = 'tool-btn primary';
    createBtn.style.width = '100%';
    createBtn.textContent = '+ New Album';
    createBtn.onclick = () => createAlbum();

    createBtnContainer.appendChild(createBtn);
    container.appendChild(createBtnContainer);

    if (state.albums.length === 0) {
        const emptyMsg = document.createElement('p');
        emptyMsg.style.padding = '1rem';
        emptyMsg.style.color = '#666';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.textContent = 'No albums yet.';
        container.appendChild(emptyMsg);
        return;
    }

    state.albums.sort((a, b) => a.position - b.position).forEach(album => {
        const card = document.createElement('div');
        card.className = `album-card ${state.activeAlbumId === album.id ? 'active' : ''}`;

        const header = document.createElement('div');
        header.className = 'album-header';
        header.innerHTML = `
            <h3>${album.title}</h3>
            <div class="album-actions">
                <button class="icon-btn album-add-btn" title="Add Page">+</button>
                <button class="icon-btn album-edit-btn" title="Rename">✎</button>
                <button class="icon-btn album-delete-btn" title="Delete">🗑️</button>
            </div>
        `;

        // ... (Attach existings listeners - simplified for brevity, assuming similar logic)
        const deleteBtn = header.querySelector('.album-delete-btn');
        deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteAlbum(album.id); });

        const editBtn = header.querySelector('.album-edit-btn');
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            // Create input element for album name
            const wrapper = document.createElement('div');
            const label = document.createElement('label');
            label.textContent = 'Album Name';
            const input = document.createElement('input');
            input.type = 'text';
            input.value = album.title;
            input.id = 'modal-input';
            wrapper.appendChild(label);
            wrapper.appendChild(input);

            openModal({
                title: 'Rename Album',
                content: wrapper,
                confirmText: 'Save',
                onConfirm: async () => {
                    if (input && input.value.trim()) {
                        await updateAlbum(album.id, { title: input.value.trim() });
                        closeModal();
                    }
                }
            });

            // Focus the input after modal opens
            setTimeout(() => input.focus(), 100);
        });

        const addBtn = header.querySelector('.album-add-btn');
        addBtn.addEventListener('click', (e) => { e.stopPropagation(); createPage({ albumId: album.id }); });

        // Toggle album selection
        header.addEventListener('click', () => {
            state.activeAlbumId = album.id;
            renderSidebar();
        });

        // Pages list
        const list = document.createElement('ul');
        list.className = 'album-pages';

        if (Array.isArray(album.pages)) {
            album.pages
                .sort((a, b) => a.position - b.position)
                .forEach((page, index) => {
                    const li = document.createElement('li');
                    li.className = `album-page ${page.id === state.activePageId ? 'active' : ''}`;

                    const contentDiv = document.createElement('div');
                    contentDiv.style.flex = '1';
                    contentDiv.innerHTML = `
                        <h4>${page.title || 'Untitled'}</h4>
                        <span>${index === 0 ? 'Cover' : `Page ${index}`}</span>
                    `;

                    // Delete button
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'icon-btn page-delete-btn';
                    deleteBtn.innerHTML = '🗑️';
                    deleteBtn.title = 'Delete Page';
                    deleteBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        console.log('Page delete button clicked, pageId:', page.id);
                        if (confirm('Are you sure you want to delete this page?')) {
                            deletePage(page.id, album.id);
                        }
                    });

                    li.appendChild(contentDiv);
                    li.appendChild(deleteBtn);

                    li.onclick = () => updateActivePage(page.id, album.id);
                    list.appendChild(li);
                });
        }

        card.appendChild(header);
        card.appendChild(list);
        container.appendChild(card);
    });
}



// Redirect old function call to new logic if called directly
function renderAlbumList() { renderSidebar(); }

function hideContextMenu() {
    if (!contextMenu) return;
    contextMenu.classList.add('hidden');
    contextTargetPageId = null;
}

async function loadAlbums() {
    try {
        const previousAlbumId = state.activeAlbumId;
        const previousPageId = state.activePageId;
        const data = await apiRequest('/albums');
        const normalizedAlbums = Array.isArray(data?.albums)
            ? data.albums.map(normalizeAlbum).filter(Boolean).sort((a, b) => a.position - b.position)
            : [];

        const normalizedPages = [];
        normalizedAlbums.forEach(album => {
            album.pages.forEach(page => normalizedPages.push(page));
        });

        state.albums = normalizedAlbums;
        state.pages = normalizedPages;
        refreshBlockZCounter();

        if (state.albums.some(album => album.id === previousAlbumId)) {
            state.activeAlbumId = previousAlbumId;
        } else {
            state.activeAlbumId = state.albums[0]?.id || null;
        }

        if (state.pages.some(page => page.id === previousPageId)) {
            state.activePageId = previousPageId;
        } else {
            const fallbackAlbum = getActiveAlbum() || state.albums[0];
            const fallbackPage = fallbackAlbum?.pages?.[0] || state.pages[0];
            state.activePageId = fallbackPage?.id || null;
        }

        const activeAlbum = getActiveAlbum();
        if (activeAlbum && !activeAlbum.pages.length) {
            const created = await createPage({ albumId: activeAlbum.id });
            if (created) {
                state.activePageId = created.id;
            }
        }

        renderAlbumList();
        renderCanvas();
    } catch (error) {
        console.error('Failed to load albums', error);
        showCanvasError(`Album verileri yüklenemedi: ${error.message}`);
    }
}



function renderStickerContent(container) {
    const grid = document.createElement('div');
    grid.className = 'sticker-grid-sidebar';

    const createStickerItem = (value, isCustom = false) => {
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.display = 'inline-block';

        const item = document.createElement('div');
        item.className = 'sticker-item-sidebar';
        item.draggable = true;

        if (value && value.startsWith('data:image')) {
            const img = document.createElement('img');
            img.src = value;
            item.appendChild(img);
        } else if (typeof value === 'string') {
            // Emoji sticker
            item.textContent = value;
            item.style.fontSize = '2rem';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.justifyContent = 'center';
        }

        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/json', JSON.stringify({
                type: 'sticker',
                value: value
            }));
            e.dataTransfer.effectAllowed = 'copy';
        });

        // Add click-to-add functionality
        item.addEventListener('click', async () => {
            console.log('Sidebar: Sticker item clicked', value);
            const activePage = getActivePage();
            if (activePage) {
                await addBlockToActivePage('sticker', value);
            } else {
                console.warn('Sidebar: No active page to add sticker to');
                alert('Please select a page first.');
            }
        });

        wrapper.appendChild(item);

        // Add delete button for custom stickers
        if (isCustom) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'sticker-delete-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = 'Delete sticker';
            deleteBtn.style.position = 'absolute';
            deleteBtn.style.top = '-5px';
            deleteBtn.style.right = '-5px';
            deleteBtn.style.width = '20px';
            deleteBtn.style.height = '20px';
            deleteBtn.style.borderRadius = '50%';
            deleteBtn.style.border = 'none';
            deleteBtn.style.background = '#ff4444';
            deleteBtn.style.color = 'white';
            deleteBtn.style.fontSize = '14px';
            deleteBtn.style.fontWeight = 'bold';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.display = 'flex';
            deleteBtn.style.alignItems = 'center';
            deleteBtn.style.justifyContent = 'center';
            deleteBtn.style.padding = '0';
            deleteBtn.style.lineHeight = '1';
            deleteBtn.style.zIndex = '10';
            deleteBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (confirm('Bu sticker\'ı silmek istediğine emin misin?')) {
                    const index = CUSTOM_STICKERS.indexOf(value);
                    if (index > -1) {
                        CUSTOM_STICKERS.splice(index, 1);
                        localStorage.setItem('custom_stickers', JSON.stringify(CUSTOM_STICKERS));
                        renderSidebar(); // Re-render sidebar to update the list
                    }
                }
            });

            wrapper.appendChild(deleteBtn);
        }

        return wrapper;
    };

    // Add sticker upload button FIRST - always at the beginning
    const addBtn = document.createElement('button');
    addBtn.className = 'sticker-item-sidebar';
    addBtn.style.border = '2px dashed #ccc';
    addBtn.textContent = '+';
    addBtn.title = 'Upload Sticker';
    addBtn.onclick = () => {
        console.log('Sidebar: Upload Sticker button clicked');
        const input = document.getElementById('sticker-input');
        if (input) {
            input.click();
        } else {
            console.error('Sidebar: sticker-input element not found!');
        }
    };
    grid.appendChild(addBtn);

    let hasStickers = false;

    // Add custom stickers
    if (Array.isArray(CUSTOM_STICKERS)) {
        console.log(`Sidebar: Rendering ${CUSTOM_STICKERS.length} custom stickers`);
        CUSTOM_STICKERS.forEach(dataUrl => {
            grid.appendChild(createStickerItem(dataUrl, true)); // true = isCustom
            hasStickers = true;
        });
    }

    // Add some default emoji stickers
    const defaultStickers = ['❤️'];
    defaultStickers.forEach(emoji => {
        grid.appendChild(createStickerItem(emoji));
        hasStickers = true;
    });

    container.appendChild(grid);

    if (!hasStickers) {
        const hint = document.createElement('p');
        hint.style.gridColumn = '1 / -1';
        hint.style.color = '#777';
        hint.style.fontSize = '0.9rem';
        hint.style.textAlign = 'center';
        hint.innerText = 'No stickers yet. Click + to upload.';
        grid.appendChild(hint);
    }
}


function renderPhotoContent(container) {
    const grid = document.createElement('div');
    grid.className = 'sticker-grid-sidebar';

    const createPhotoItem = (value, isCustom = false) => {
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.display = 'inline-block';

        const item = document.createElement('div');
        item.className = 'sticker-item-sidebar';
        item.draggable = true;

        if (value && value.startsWith('data:image')) {
            const img = document.createElement('img');
            img.src = value;
            item.appendChild(img);
        }

        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/json', JSON.stringify({
                type: 'photo',
                value: value
            }));
            e.dataTransfer.effectAllowed = 'copy';
        });

        // Add click-to-add functionality
        item.addEventListener('click', async () => {
            console.log('Sidebar: Photo item clicked', value);
            const activePage = getActivePage();
            if (activePage) {
                await addBlockToActivePage('photo', value);
            } else {
                console.warn('Sidebar: No active page to add photo to');
                alert('Please select a page first.');
            }
        });

        wrapper.appendChild(item);

        // Add delete button for custom photos
        if (isCustom) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'photo-delete-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = 'Delete photo';
            deleteBtn.style.position = 'absolute';
            deleteBtn.style.top = '-5px';
            deleteBtn.style.right = '-5px';
            deleteBtn.style.width = '20px';
            deleteBtn.style.height = '20px';
            deleteBtn.style.borderRadius = '50%';
            deleteBtn.style.border = 'none';
            deleteBtn.style.background = '#ff4444';
            deleteBtn.style.color = 'white';
            deleteBtn.style.fontSize = '14px';
            deleteBtn.style.fontWeight = 'bold';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.display = 'flex';
            deleteBtn.style.alignItems = 'center';
            deleteBtn.style.justifyContent = 'center';
            deleteBtn.style.padding = '0';
            deleteBtn.style.lineHeight = '1';
            deleteBtn.style.zIndex = '10';
            deleteBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (confirm('Bu fotoğrafı silmek istediğine emin misin?')) {
                    const index = CUSTOM_PHOTOS.indexOf(value);
                    if (index > -1) {
                        CUSTOM_PHOTOS.splice(index, 1);
                        localStorage.setItem('custom_photos', JSON.stringify(CUSTOM_PHOTOS));
                        renderSidebar(); // Re-render sidebar to update the list
                    }
                }
            });

            wrapper.appendChild(deleteBtn);
        }

        return wrapper;
    };

    // Add photo button FIRST - always at the beginning
    const addBtn = document.createElement('button');
    addBtn.className = 'sticker-item-sidebar';
    addBtn.style.border = '2px dashed #ccc';
    addBtn.textContent = '+';
    addBtn.title = 'Upload Photo';
    addBtn.onclick = () => {
        console.log('Sidebar: Upload Photo button clicked');
        const input = document.getElementById('photo-input');
        if (input) {
            input.click();
        } else {
            console.error('Sidebar: photo-input element not found!');
        }
    };
    grid.appendChild(addBtn);

    // Then add custom photos
    let hasPhotos = false;
    if (Array.isArray(CUSTOM_PHOTOS)) {
        console.log(`Sidebar: Rendering ${CUSTOM_PHOTOS.length} custom photos`);
        CUSTOM_PHOTOS.forEach(dataUrl => {
            grid.appendChild(createPhotoItem(dataUrl, true)); // true = isCustom
            hasPhotos = true;
        });
    }

    container.appendChild(grid);

    if (!hasPhotos) {
        const hint = document.createElement('p');
        hint.style.gridColumn = '1 / -1';
        hint.style.color = '#777';
        hint.style.fontSize = '0.9rem';
        hint.style.textAlign = 'center';
        hint.innerText = 'No photos yet. Click + to upload.';
        grid.appendChild(hint);
    }
}



function showCanvasError(message) {
    if (!bookEl) return;
    bookEl.innerHTML = `
        <div class="empty-state">
            <p class="empty-eyebrow" style="color: #e74c3c;">Error</p>
            <h1>Something went wrong</h1>
            <p>${message}</p>
            <p style="margin-top: 1rem; font-size: 0.9rem; color: #666;">
                Check the browser console for more details.
            </p>
        </div>
    `;
}



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

    // Optimization: Update content in-place if page structure hasn't changed
    // This prevents destroying the PageFlip instance when just adding/removing blocks
    const domPages = Array.from(bookEl.querySelectorAll('.page'));
    if (pageFlip && pages.length > 0 && domPages.length === pages.length) {
        const canUpdateInPlace = domPages.every((el, i) => el.getAttribute('data-page-id') == pages[i].id);

        if (canUpdateInPlace && pages.length > 0) {
            // console.log('Updating canvas in-place');
            pages.forEach((page, i) => {
                const pageEl = domPages[i];
                pageEl.innerHTML = ''; // Clear existing blocks
                renderPageContent(pageEl, page); // Re-render blocks
            });
            return;
        }
    }

    // Full re-render needed (page count changed or initial load)

    // 1. Destroy existing instance FIRST to avoid errors
    if (pageFlip) {
        console.log('renderCanvas: Destroying existing PageFlip instance');
        try {
            pageFlip.destroy();
        } catch (e) {
            console.warn('Error destroying pageFlip:', e);
        }
        pageFlip = null;
    }

    // 2. Clear container
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

    // 3. Create page elements
    console.log(`renderCanvas: Creating ${pages.length} page elements`);
    pages.forEach((page, index) => {
        const pageDiv = document.createElement('div');
        pageDiv.className = 'page';

        // Use setAttribute for page-flip.js compatibility
        pageDiv.setAttribute('data-page-id', page.id);
        // USER REQUEST: Enable curl on first page too. 'hard' prevents curl.
        // Changing to 'soft' for all pages enables curl everywhere.
        pageDiv.setAttribute('data-density', 'soft');

        // Enable Drag & Drop for stickers
        enablePageDrop(pageDiv, page);

        // Render page content directly
        renderPageContent(pageDiv, page);

        bookEl.appendChild(pageDiv);
    });

    // 4. Initialize page-flip.js
    console.log('renderCanvas: Initializing PageFlip...');
    initPageFlip();

    if (pageFlip) {
        try {
            const pageElements = Array.from(bookEl.querySelectorAll('.page'));
            console.log(`renderCanvas: Loading ${pageElements.length} pages into PageFlip`);

            if (pageElements.length > 0) {
                pageFlip.loadFromHTML(pageElements);
                updatePageInfo();
                updateNavigationButtons();
                console.log('renderCanvas: PageFlip successfully loaded');
            } else {
                console.warn('renderCanvas: No page elements found to load');
            }
        } catch (error) {
            console.error('Error loading pages into PageFlip:', error);
        }
    } else {
        console.error('renderCanvas: PageFlip instance was NOT created');
    }
}


function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Initialize Page-Flip.js
function initPageFlip() {
    if (!bookEl) return;

    // Remove existing listeners if any (simple way is to just add them, browser handles duplicates for named functions, but for anon functions it adds more. 
    // Ideally we'd clean up, but for this quick fix we'll debounce and just add once if possible, or accept minor multiple firings which debounce handles.
    // Better: check if we attached them already. 
    if (!window.bookResizeListener) {
        window.bookResizeListener = debounce(() => {
            renderCanvas();
        }, 200);
        window.addEventListener('resize', window.bookResizeListener);
    }

    // Hook sidebar toggle if not already hooked
    if (toggleAlbumsBtn && !toggleAlbumsBtn.hasResizeHook) {
        toggleAlbumsBtn.addEventListener('click', () => {
            setTimeout(() => {
                renderCanvas();
            }, 350);
        });
        toggleAlbumsBtn.hasResizeHook = true;
    }

    // Calculate dynamic dimensions
    const wrapper = document.querySelector('.book-wrapper');
    const availableWidth = wrapper ? wrapper.clientWidth : window.innerWidth;
    const availableHeight = wrapper ? wrapper.clientHeight : window.innerHeight;

    // Target spread width: 95% of available space (maximize size)
    // Reduce margins to satisfy "5% empty space" => 95% used
    let targetSpreadWidth = availableWidth * 0.95;

    // Page width is half of spread
    let pageWidth = Math.floor(targetSpreadWidth / 2);

    // Maintain aspect ratio (e.g., 3:4)
    let pageHeight = Math.floor(pageWidth * 1.33);

    // Check if height fits
    const maxHeight = availableHeight * 0.98;
    if (pageHeight > maxHeight) {
        pageHeight = maxHeight;
        // Recalculate width based on constrained height
        pageWidth = Math.floor(pageHeight / 1.33);
    }

    // Ensure logical minimums (Increase to avoid "tiny book" syndrome)
    pageWidth = Math.max(500, pageWidth); // Minimum 500px width per page
    pageHeight = Math.max(700, pageHeight); // Minimum 700px height per page

    // Update blocker dimensions to match the book
    const spreadWidth = pageWidth * 2;
    const blockerEl = document.querySelector('.corner-blockers');
    if (blockerEl) {
        blockerEl.style.width = `${spreadWidth}px`;
        blockerEl.style.height = `${pageHeight}px`;
    }

    try {
        pageFlip = new St.PageFlip(bookEl, {
            width: pageWidth,
            height: pageHeight,
            size: 'fixed',
            minWidth: 200,
            maxWidth: 3000,
            minHeight: 300,
            maxHeight: 3000,
            showCover: true,
            mobileScrollSupport: false,
            swipeDistance: 10000, // Effectively disable swipe
            disableFlipByClick: true,
            clickEventForward: true,
            usePortrait: false,
            useMouseEvents: false // Disable drag-to-flip via mouse/touch
        });

        pageFlip.on('flip', (e) => {
            playFlipSound();
            updatePageInfo();

            // Sync sidebar with active page
            const newIndex = e.data;
            const pages = getAlbumPages();
            if (pages && pages[newIndex]) {
                state.activePageId = pages[newIndex].id;
                renderAlbumList();

                // Scroll active item into view
                setTimeout(() => {
                    const activeItem = document.querySelector('.album-page.active');
                    if (activeItem) {
                        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }, 100);
            }
        });

        pageFlip.on('changeState', (e) => {
            updateNavigationButtons();
        });
    } catch (error) {
        console.error('Failed to initialize PageFlip:', error);
    }
}

// Render page content (blocks)
function renderPageContent(container, page) {
    if (!page.content || !Array.isArray(page.content)) return;

    page.content.forEach(block => {
        const blockEl = document.createElement('div');
        blockEl.className = 'page-block';
        blockEl.dataset.blockId = block.id;
        blockEl.setAttribute('data-type', block.type); // Critical for CSS targeting

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

        applyBlockStyles(blockEl, block);

        // --- Controls: Delete (Top-Left), Resize (Bottom-Right), Rotate (Top-Right) ---

        // Delete Button (Top-Left)
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'block-control block-delete';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Delete';
        deleteBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
        });
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('Block delete button clicked, blockId:', block.id);
            if (confirm('Delete this item?')) {
                removeBlock(page.id, block.id);
            }
        });
        blockEl.appendChild(deleteBtn);

        // Resize Handle (Bottom-Right)
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'block-control block-resize';
        blockEl.appendChild(resizeHandle);

        // Rotate Handle (Top-Right)
        const rotateHandle = document.createElement('div');
        rotateHandle.className = 'block-control block-rotate';
        rotateHandle.innerHTML = '↻';
        rotateHandle.title = 'Drag to Rotate';
        blockEl.appendChild(rotateHandle);

        // Enable interactions
        enableBlockDrag(blockEl, block, container, page);
        enableBlockResize(blockEl, block, container, page, resizeHandle);
        enableBlockRotation(blockEl, block, page, rotateHandle);

        container.appendChild(blockEl);
    });
}

function renderPageSide(page, element, { side, isCover }) {
    element.innerHTML = '';
    element.classList.toggle('book-page--cover', Boolean(isCover && side === 'right'));
    element.classList.toggle('book-page--empty', !page);
    element.classList.toggle('book-page--active', Boolean(page && page.id === state.activePageId));

    if (!page) {
        const empty = document.createElement('div');
        empty.className = 'page-empty';
        empty.innerHTML = `
            <p class="empty-eyebrow">${isCover && side === 'right' ? 'Cover' : 'Blank Page'}</p>
            <p>${isCover && side === 'right'
                ? 'Pull from the right edge to reveal the first page.'
                : 'Add new blocks to begin filling this page with memories.'}</p>
        `;
        element.appendChild(empty);
        return;
    }

    const heading = document.createElement('div');
    heading.className = 'page-heading';
    heading.textContent = page.title || 'Untitled Page';
    element.appendChild(heading);

    const blocksWrapper = document.createElement('div');
    blocksWrapper.className = 'page-blocks';
    element.appendChild(blocksWrapper);

    const content = Array.isArray(page.content) ? page.content : [];
    if (!content.length) {
        const placeholder = document.createElement('div');
        placeholder.className = 'page-empty page-empty--inner';
        placeholder.innerHTML = `
            <p class="empty-eyebrow">${isCover ? 'Cover Page' : 'Blank Page'}</p>
            <p>${isCover
                ? 'Click "Add Photo" or "Add Text" to design your cover.'
                : 'Add text or photos.'}</p>
        `;
        blocksWrapper.appendChild(placeholder);
    }

    // Continue rendering even if empty (especially for cover pages)

    let layoutPatched = false;
    let maxBottom = 0;

    content.forEach(block => {
        if (ensureBlockLayout(block)) {
            layoutPatched = true;
        }

        const blockEl = document.createElement('div');
        blockEl.className = `page-block page-block--${block.type}`;
        blockEl.dataset.blockId = block.id;
        applyBlockStyles(blockEl, block);

        const actions = document.createElement('div');
        actions.className = 'block-actions';

        const rotateBtn = document.createElement('button');
        rotateBtn.textContent = '↻';
        rotateBtn.title = 'Döndür';
        rotateBtn.style.cursor = 'grab';
        enableBlockRotation(blockEl, block, page, rotateBtn);
        actions.appendChild(rotateBtn);

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.title = 'Bloğu sil';
        removeBtn.addEventListener('click', () => removeBlock(page.id, block.id));
        actions.appendChild(removeBtn);
        blockEl.appendChild(actions);

        if (block.type === 'text') {
            const textEl = document.createElement('div');
            textEl.contentEditable = 'true';

            // Handle both old (string) and new (object) format
            let textContent = '';
            let fontFamily = 'Playfair Display';

            if (typeof block.value === 'string') {
                textContent = block.value;
            } else if (typeof block.value === 'object' && block.value !== null) {
                textContent = block.value.text || '';
                fontFamily = block.value.fontFamily || 'Playfair Display';
            }

            textEl.textContent = textContent || 'Metninizi girin...';
            textEl.style.fontFamily = fontFamily;

            // Calculate font size based on block height or use stored value
            const blockHeight = block.height || 160;
            const fontSize = block.fontSize || Math.max(12, Math.min(72, blockHeight / 8));
            textEl.style.fontSize = `${fontSize}px`;
            textEl.style.lineHeight = '1.4';

            textEl.addEventListener('input', () => {
                if (typeof block.value === 'object' && block.value !== null) {
                    block.value.text = textEl.textContent;
                } else {
                    block.value = textEl.textContent;
                }
                scheduleSave(page.id);
            });
            blockEl.appendChild(textEl);
        } else if (block.type === 'photo' && block.value) {
            const img = document.createElement('img');
            img.src = block.value;
            img.alt = 'Yüklenen fotoğraf';
            blockEl.appendChild(img);
        } else if (block.type === 'sticker' && block.value) {
            if (block.value.startsWith('data:image')) {
                const img = document.createElement('img');
                img.src = block.value;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'contain';
                img.style.pointerEvents = 'none'; // Ensure drag works on container
                blockEl.appendChild(img);
            } else {
                const stickerEl = document.createElement('span');
                stickerEl.className = 'sticker-emoji';
                stickerEl.textContent = block.value;
                // Set initial font size based on height
                const height = block.height || 180;
                stickerEl.style.fontSize = `${height * 0.8}px`;
                blockEl.appendChild(stickerEl);
            }
        }

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'block-resize-handle';
        blockEl.appendChild(resizeHandle);

        enableBlockDrag(blockEl, block, blocksWrapper, page);
        enableBlockResize(blockEl, block, blocksWrapper, page, resizeHandle);

        blocksWrapper.appendChild(blockEl);
    });

    // Keep page size fixed - don't adjust based on content
    // blocksWrapper.style.minHeight is already set in CSS (600px)
    if (layoutPatched) {
        scheduleSave(page.id);
    }
}
function getActiveAlbum() {
    return state.albums.find((album) => album.id === state.activeAlbumId);
}

function getAlbumPages(albumId = state.activeAlbumId) {
    const album = state.albums.find((alb) => alb.id === albumId);
    return album ? album.pages || [] : [];
}

function getAlbumSpreads(albumId = state.activeAlbumId) {
    const pages = getAlbumPages(albumId);
    if (!pages.length) return [];

    const spreads = [];
    const [cover, ...rest] = pages;

    if (cover) {
        spreads.push({
            type: 'cover',
            left: null,
            right: cover
        });
    }

    for (let i = 0; i < rest.length; i += 2) {
        const left = rest[i] || null;
        const right = rest[i + 1] || null;
        if (right || left) {
            spreads.push({
                type: 'spread',
                left,
                right
            });
        }
    }

    return spreads;
}

function pickPrimaryPage(spread, preferRight = true) {
    if (!spread) return null;
    return preferRight
        ? (spread.right || spread.left || null)
        : (spread.left || spread.right || null);
}

function getActivePage() {
    return state.pages.find((p) => p.id === state.activePageId);
}

function getCurrentSpreadContext() {
    const spreads = getAlbumSpreads();
    if (!spreads.length) {
        return { spreads: [], spread: null, index: -1 };
    }

    let index = spreads.findIndex(spread => {
        const ids = [spread.left?.id, spread.right?.id].filter(Boolean);
        return ids.includes(state.activePageId);
    });

    if (index === -1) {
        index = 0;
        const fallback = pickPrimaryPage(spreads[0]);
        if (fallback) {
            state.activePageId = fallback.id;
            state.activeAlbumId = fallback.albumId;
        }
    }

    return {
        spreads,
        spread: spreads[index],
        index
    };
}

function updateActivePage(pageId, albumId = null) {
    if (albumId !== null) {
        state.activeAlbumId = albumId;
    }
    state.activePageId = pageId;
    renderAlbumList();
    renderCanvas();
}

function syncAlbumPages(page) {
    state.albums.forEach(album => {
        if (!Array.isArray(album.pages)) {
            album.pages = [];
        }
        if (album.id === page.albumId) {
            return;
        }
        const idx = album.pages.findIndex(p => p.id === page.id);
        if (idx > -1) {
            album.pages.splice(idx, 1);
        }
    });

    const album = state.albums.find(a => a.id === page.albumId);
    if (!album) return;

    const index = album.pages.findIndex(p => p.id === page.id);
    if (index > -1) {
        album.pages[index] = page;
    } else {
        album.pages.push(page);
    }
    album.pages.sort((a, b) => a.position - b.position);

    if (page.id === state.activePageId) {
        state.activeAlbumId = page.albumId;
    }
}

function flipToRelativeSpread(offset) {
    const { spreads, index } = getCurrentSpreadContext();
    if (!spreads.length) return;

    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= spreads.length) return;

    const targetSpread = spreads[targetIndex];
    const targetPage = pickPrimaryPage(targetSpread);
    if (!targetPage) return;

    const direction = offset > 0 ? 'right' : 'left';
    animatePageTurn(targetPage, direction);
}

function animatePageTurn(targetPage, direction) {
    const flipbookEl = canvasEl.querySelector('.flipbook');
    playFlipSound();
    if (!flipbookEl) {
        updateActivePage(targetPage.id, targetPage.albumId);
        return;
    }

    flipbookEl.classList.remove('flipbook--turn-left', 'flipbook--turn-right');
    flipbookEl.classList.add(direction === 'right' ? 'flipbook--turn-right' : 'flipbook--turn-left');

    setTimeout(() => {
        flipbookEl.classList.remove('flipbook--turn-left', 'flipbook--turn-right');
        updateActivePage(targetPage.id, targetPage.albumId);
    }, 450);
}

function attachFlipbookDrag(flipbook, { hasPrev, hasNext }) {
    if (!window.PointerEvent) {
        return;
    }

    const clearPreview = () => {
        flipbook.classList.remove('flipbook--preview');
        flipbook.style.removeProperty('--flip-preview-angle');
    };

    const endDrag = (pointerId) => {
        if (!dragState) return;
        if (pointerId != null && typeof flipbook.releasePointerCapture === 'function') {
            try {
                flipbook.releasePointerCapture(pointerId);
            } catch (err) {
                // ignore
            }
        }
        flipbook.classList.remove(
            'flipbook--dragging',
            'flipbook--dragging-left',
            'flipbook--dragging-right',
            'flipbook--preview'
        );
        flipbook.style.removeProperty('--flip-preview-angle');
        dragState = null;
    };

    const onPointerDown = (event) => {
        if (dragState) return;

        // Ignore drag if interacting with a block or controls
        if (event.target.closest('.page-block') ||
            event.target.closest('.block-resize-handle') ||
            event.target.closest('.block-actions')) {
            return;
        }

        const rect = flipbook.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        let direction = null;

        if (offsetX <= EDGE_DRAG_ZONE && hasPrev) {
            direction = 'left';
        } else if ((rect.width - offsetX) <= EDGE_DRAG_ZONE && hasNext) {
            direction = 'right';
        }

        if (!direction) return;

        dragState = {
            pointerId: event.pointerId,
            direction,
            startX: event.clientX
        };

        if (typeof flipbook.setPointerCapture === 'function') {
            try {
                flipbook.setPointerCapture(event.pointerId);
            } catch (err) {
                // ignore
            }
        }
        flipbook.classList.add('flipbook--dragging', `flipbook--dragging-${direction}`);
    };

    const onPointerMove = (event) => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        const delta = event.clientX - dragState.startX;
        let previewAngle = 0;

        if (dragState.direction === 'right' && delta < 0) {
            previewAngle = Math.min(160, Math.abs(delta) / 1.2);
        } else if (dragState.direction === 'left' && delta > 0) {
            previewAngle = Math.min(160, delta / 1.2);
        } else {
            previewAngle = 0;
        }

        if (previewAngle > 0) {
            flipbook.style.setProperty('--flip-preview-angle', `${previewAngle}deg`);
            flipbook.classList.add('flipbook--preview');
        } else {
            clearPreview();
        }
    };

    const onPointerUp = (event) => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        const delta = event.clientX - dragState.startX;
        const direction = dragState.direction;

        const shouldFlip = (
            (direction === 'right' && delta <= -FLIP_DRAG_THRESHOLD) ||
            (direction === 'left' && delta >= FLIP_DRAG_THRESHOLD)
        );

        endDrag(event.pointerId);

        if (shouldFlip) {
            flipToRelativeSpread(direction === 'right' ? 1 : -1);
        } else {
            clearPreview();
        }
    };

    const onPointerCancel = (event) => {
        if (!dragState || (event.pointerId && dragState.pointerId !== event.pointerId)) {
            return;
        }
        endDrag(event.pointerId);
        clearPreview();
    };

    flipbook.addEventListener('pointerdown', onPointerDown);
    flipbook.addEventListener('pointermove', onPointerMove);
    flipbook.addEventListener('pointerup', onPointerUp);
    flipbook.addEventListener('pointercancel', onPointerCancel);
    flipbook.addEventListener('pointerleave', (event) => {
        if (!dragState || (event.pointerId && dragState.pointerId !== event.pointerId)) {
            return;
        }
        endDrag(event.pointerId);
        clearPreview();
    });
}
async function createPage(options = {}) {
    const {
        title = 'New Page',
        setActive = true,
        albumId = state.activeAlbumId
    } = options;

    try {
        const album = state.albums.find(a => a.id === albumId);
        if (!album) throw new Error('Album not found');

        const response = await apiRequest('/pages', {
            method: 'POST',
            body: {
                title,
                albumId: album.id
            }
        });

        const created = normalizePage(response?.page);
        if (!created) throw new Error('Page could not be created');

        state.pages.push(created);
        syncAlbumPages(created);

        if (setActive) {
            state.activePageId = created.id;
        }

        // Always render both sidebar and canvas after creating a page
        renderAlbumList();
        renderCanvas();

        return created;
    } catch (error) {
        console.error('Failed to create page', error);
        alert('An error occurred while creating the page.');
    }
}

async function deleteActivePage() {
    const page = getActivePage();
    if (!page) return;
    if (state.pages.length <= 1) {
        alert('En az bir sayfa kalmalı.');
        return;
    }

    const confirmed = confirm(`${page.title || "bu sayfayı"} silmek istediğine emin misin?`);
    if (!confirmed) return;

    try {
        await deletePage(page.id, page.albumId);
    } catch (error) {
        console.error('Page silinemedi', error);
        alert(`Sayfa silinemedi: ${error.message}`);
    }
}




async function addBlockToActivePage(type, value) {
    console.log(`addBlockToActivePage called with type: ${type}`);
    const page = getActivePage();
    if (!page) {
        console.error('addBlockToActivePage: No active page found!');
        alert('Lütfen önce bir sayfa seçin.');
        return;
    }
    console.log('addBlockToActivePage: Adding to page', page.id);

    let options = {};
    if (type === 'photo' && typeof value === 'string' && value.startsWith('data:image')) {
        try {
            const dims = await getImageDimensions(value);
            // Scale down if too large, maintaining aspect ratio
            const maxDim = 320;
            let { width, height } = dims;
            if (width > maxDim || height > maxDim) {
                const ratio = width / height;
                if (width > height) {
                    width = maxDim;
                    height = width / ratio;
                } else {
                    height = maxDim;
                    width = height * ratio;
                }
            }
            options = { width, height };
        } catch (e) {
            console.error('Failed to get image dimensions', e);
        }
    }

    const block = createBlock(type, value, page, options);
    page.content = Array.isArray(page.content) ? [...page.content, block] : [block];

    renderCanvas();
    scheduleSave(page.id);
}

async function deletePage(pageId, albumId) {
    try {
        await apiRequest(`/pages/${pageId}`, { method: 'DELETE' });
    } catch (error) {
        throw new Error(error.message || 'Server rejected page delete');
    }

    // Update local state
    const album = state.albums.find(a => a.id === albumId);
    if (album) {
        album.pages = album.pages.filter(p => p.id !== pageId);
    }
    state.pages = state.pages.filter(p => p.id !== pageId);

    // If deleted page was active, switch to another
    if (state.activePageId === pageId) {
        const remainingPage = album?.pages?.[0];
        if (remainingPage) {
            state.activePageId = remainingPage.id;
        } else {
            state.activePageId = null;
        }
    }

    // Always render both sidebar and canvas after deleting a page
    renderSidebar();
    renderCanvas();
}

async function updateAlbum(albumId, updates) {
    const album = state.albums.find(a => a.id === albumId);
    if (!album) return;

    const nextTitle = typeof updates?.title === 'string' && updates.title.trim().length
        ? updates.title.trim()
        : album.title;

    try {
        const response = await apiRequest(`/albums/${albumId}`, {
            method: 'PUT',
            body: { title: nextTitle }
        });

        if (response?.album) {
            album.title = response.album.title;
            album.position = response.album.position;
        } else {
            album.title = nextTitle;
        }

        renderSidebar();
    } catch (error) {
        console.error('Album update failed', error);
        alert(`Album güncellenemedi: ${error.message}`);
    }
}

async function deleteAlbum(albumId) {
    if (!confirm('Are you sure you want to delete this album?')) return;

    try {
        await apiRequest(`/albums/${albumId}`, { method: 'DELETE' });
    } catch (error) {
        console.error('Album delete failed', error);
        alert(`Album silinemedi: ${error.message}`);
        return;
    }

    state.albums = state.albums.filter(a => a.id !== albumId);
    state.pages = state.pages.filter(p => p.albumId !== albumId); // Sync flat pages list too

    if (state.activeAlbumId === albumId) {
        state.activeAlbumId = state.albums[0]?.id || null;
        state.activePageId = null;
        await loadAlbums(); // Reload from server to stay in sync
    } else {
        renderSidebar();
        renderCanvas();
    }
}

function getImageDimensions(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = reject;
        img.src = src;
    });
}

function resizeImage(src, maxDim, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let width = img.naturalWidth;
            let height = img.naturalHeight;

            if (width > maxDim || height > maxDim) {
                const ratio = width / height;
                if (width > height) {
                    width = maxDim;
                    height = width / ratio;
                } else {
                    height = maxDim;
                    width = height * ratio;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = src;
    });
}

function removeBlock(pageId, blockId) {
    const page = state.pages.find(p => p.id === pageId);
    if (!page) return;
    page.content = page.content.filter(block => block.id !== blockId);
    renderCanvas();
    scheduleSave(page.id);
}

function applyBlockStyles(blockEl, block) {
    blockEl.style.left = `${block.x || 0}px`;
    blockEl.style.top = `${block.y || 0}px`;

    // For text blocks, don't set width/height - let CSS fit-content work
    if (block.type === 'text') {
        // CSS handles sizing with fit-content
    } else {
        blockEl.style.width = `${block.width || 260}px`;
        if (block.type === 'photo' || block.type === 'sticker') {
            blockEl.style.height = `${block.height || 180}px`;
        } else {
            blockEl.style.minHeight = `${block.height || 140}px`;
            blockEl.style.height = 'auto';
        }
    }
    blockEl.style.zIndex = block.z || 1;

    // Apply rotation if set
    if (block.rotation) {
        blockEl.style.transform = `rotate(${block.rotation}deg)`;
    }
}

function enableBlockDrag(blockEl, block, container, page) {
    blockEl.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('.block-actions') || event.target.classList.contains('block-resize-handle')) {
            return;
        }
        if (event.target.closest('[contenteditable="true"]')) {
            return;
        }
        event.preventDefault();
        bringBlockToFront(blockEl, block);
        const pointerId = event.pointerId;
        const containerRect = container.getBoundingClientRect();
        const blockRect = blockEl.getBoundingClientRect();

        // Calculate scale (Screen Pixels / CSS Pixels)
        const scaleX = containerRect.width / container.offsetWidth;
        const scaleY = containerRect.height / container.offsetHeight;

        const offsetX = event.clientX - blockRect.left;
        const offsetY = event.clientY - blockRect.top;

        blockEl.classList.add('page-block--dragging');
        if (blockEl.setPointerCapture) {
            try {
                blockEl.setPointerCapture(pointerId);
            } catch (err) {
                // ignore capture errors
            }
        }

        const onMove = (moveEvent) => {
            if (moveEvent.pointerId !== pointerId) return;

            // Current mouse position in screen space relative to container
            // (moveEvent.clientX - containerRect.left) is the mouse pos inside container (screen pixels)
            // Subtract offsetX to get the block's top-left corner (screen pixels)
            const rawLeft = (moveEvent.clientX - containerRect.left) - offsetX;
            const rawTop = (moveEvent.clientY - containerRect.top) - offsetY;

            // Convert to CSS pixels
            const cssLeft = rawLeft / scaleX;
            const cssTop = rawTop / scaleY;

            // Calculate bounds in CSS pixels
            // Use blockEl.offsetWidth/Height for CSS size
            const maxLeft = container.offsetWidth - blockEl.offsetWidth;
            const maxTop = container.offsetHeight - blockEl.offsetHeight;

            // Clamp and apply
            const nextLeft = clamp(cssLeft, 0, maxLeft);
            const nextTop = clamp(cssTop, 0, maxTop);

            blockEl.style.left = `${nextLeft}px`;
            blockEl.style.top = `${nextTop}px`;
        };

        const release = () => {
            blockEl.classList.remove('page-block--dragging');
            block.x = parseFloat(blockEl.style.left) || 0;
            block.y = parseFloat(blockEl.style.top) || 0;
            if (page?.id) {
                scheduleSave(page.id);
            }
        };

        const onUp = (upEvent) => {
            if (upEvent.pointerId !== pointerId) return;
            cleanup();
        };

        const onCancel = (cancelEvent) => {
            if (cancelEvent.pointerId && cancelEvent.pointerId !== pointerId) return;
            cleanup();
        };

        const cleanup = () => {
            if (blockEl.releasePointerCapture) {
                try {
                    blockEl.releasePointerCapture(pointerId);
                } catch (err) {
                    // ignore
                }
            }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
            release();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
    });
}

function enableBlockResize(blockEl, block, container, page, handle) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        bringBlockToFront(blockEl, block);
        const pointerId = event.pointerId;
        if (handle.setPointerCapture) {
            try {
                handle.setPointerCapture(pointerId);
            } catch (err) {
                // ignore capture errors
            }
        }
        blockEl.classList.add('page-block--resizing');

        const containerRect = container.getBoundingClientRect();
        const startWidth = blockEl.offsetWidth;
        const startHeight = blockEl.offsetHeight;
        const aspectRatio = startWidth / startHeight;
        const startX = event.clientX;
        const startY = event.clientY;

        // Capture initial font size for text blocks
        let startFontSize = 16;
        if (block.type === 'text') {
            const textEl = blockEl.querySelector('div[contenteditable="true"]');
            if (textEl) {
                startFontSize = parseFloat(window.getComputedStyle(textEl).fontSize) || 16;
            }
        }

        const minWidth = block.type === 'sticker' ? 40 : 100;
        const minHeight = block.type === 'sticker' ? 40 : 40;

        const onMove = (moveEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            const deltaX = moveEvent.clientX - startX;

            let newWidth, newHeight;

            if (block.type === 'text') {
                // Text resize logic (scale based on diagonal movement or width change)
                // Simplified: Calculate scale based on new width vs start width
                const deltaX = moveEvent.clientX - startX;
                const newWidth = Math.max(50, startWidth + deltaX);
                const scale = newWidth / startWidth;

                const newFontSize = Math.max(12, Math.min(200, startFontSize * scale));

                const textEl = blockEl.querySelector('div[contenteditable="true"]');
                if (textEl) {
                    textEl.style.fontSize = `${newFontSize}px`;
                    block.fontSize = newFontSize; // Update block data immediately
                }
            } else {
                // Sticker/Photo resize logic (maintain aspect ratio)
                const maxWidth = Math.max(minWidth, containerRect.width - (block.x || 0));
                newWidth = clamp(startWidth + deltaX, minWidth, maxWidth);
                newHeight = newWidth / aspectRatio;

                blockEl.style.width = `${newWidth}px`;
                blockEl.style.height = `${newHeight}px`;

                // Update sticker font size if applicable
                const stickerEl = blockEl.querySelector('.sticker-emoji');
                if (stickerEl) {
                    stickerEl.style.fontSize = `${newHeight * 0.8}px`;
                }
            }
        };

        const release = () => {
            blockEl.classList.remove('page-block--resizing');

            if (block.type === 'text') {
                const textEl = blockEl.querySelector('div[contenteditable="true"]');
                if (textEl) {
                    block.fontSize = parseFloat(textEl.style.fontSize);
                }
            } else {
                block.width = parseFloat(blockEl.style.width) || blockEl.offsetWidth;
                block.height = parseFloat(blockEl.style.height) || blockEl.offsetHeight;
            }

            if (page?.id) {
                scheduleSave(page.id);
            }
        };

        const cleanup = () => {
            if (handle.releasePointerCapture) {
                try {
                    handle.releasePointerCapture(pointerId);
                } catch (err) {
                    // ignore
                }
            }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
            release();
        };

        const onUp = (upEvent) => {
            if (upEvent.pointerId !== pointerId) return;
            cleanup();
        };

        const onCancel = (cancelEvent) => {
            if (cancelEvent.pointerId && cancelEvent.pointerId !== pointerId) return;
            cleanup();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
    });
}

function ensureBlockLayout(block) {
    let updated = false;
    if (typeof block.x !== 'number' || Number.isNaN(block.x)) {
        block.x = 40 + Math.round(Math.random() * 140);
        updated = true;
    }
    if (typeof block.y !== 'number' || Number.isNaN(block.y)) {
        block.y = 40 + Math.round(Math.random() * 120);
        updated = true;
    }

    const defaults = getBlockDefaults(block.type);
    if (typeof block.width !== 'number' || Number.isNaN(block.width)) {
        block.width = defaults.width;
        updated = true;
    }
    if (typeof block.height !== 'number' || Number.isNaN(block.height)) {
        block.height = defaults.height;
        updated = true;
    }

    if (typeof block.z !== 'number' || Number.isNaN(block.z)) {
        block.z = ++blockZCounter;
        updated = true;
    } else {
        blockZCounter = Math.max(blockZCounter, block.z);
    }

    return updated;
}

function getBlockDefaults(type) {
    if (type === 'photo') {
        return { width: 320, height: 240 };
    }
    if (type === 'sticker') {
        return { width: 80, height: 80 }; // Reduced from 140 to 80
    }
    return { width: 320, height: 160 };
}

function createBlock(type, value, page, options = {}) {
    const existingCount = Array.isArray(page?.content) ? page.content.length : 0;
    const baseOffset = existingCount * 35;
    const block = {
        id: uid(),
        type,
        value,
        x: 40 + (baseOffset % 200),
        y: 40 + ((baseOffset / 2) % 180),
        ...options
    };
    ensureBlockLayout(block);
    return block;
}

function bringBlockToFront(blockEl, block) {
    blockZCounter += 1;
    block.z = blockZCounter;
    blockEl.style.zIndex = block.z;
}

function clamp(value, min, max) {
    if (max <= min) return min;
    return Math.min(Math.max(value, min), max);
}

function refreshBlockZCounter() {
    let maxZ = 10;
    state.pages.forEach(page => {
        (page.content || []).forEach(block => {
            if (typeof block.z === 'number' && !Number.isNaN(block.z)) {
                maxZ = Math.max(maxZ, block.z);
            }
        });
    });
    blockZCounter = maxZ;
}

function scheduleSave(pageId) {
    if (saveTimers.has(pageId)) {
        clearTimeout(saveTimers.get(pageId));
    }

    const timer = setTimeout(() => persistPage(pageId), 600);
    saveTimers.set(pageId, timer);
}

async function flushPendingSaves() {
    const pendingPageIds = Array.from(saveTimers.keys());
    saveTimers.forEach(timer => clearTimeout(timer));
    saveTimers.clear();

    await Promise.all(pendingPageIds.map(pageId => persistPage(pageId)));
}

async function persistPage(pageId) {
    const page = state.pages.find(p => p.id === pageId);
    if (!page) return;

    try {
        const response = await apiRequest(`/pages/${pageId}`, {
            method: 'PUT',
            body: {
                title: page.title,
                content: page.content,
                position: page.position,
                albumId: page.albumId
            }
        });

        if (response?.page) {
            const updated = normalizePage(response.page);
            // Preserve the current in-memory content instead of replacing it
            // This prevents race conditions where local changes haven't been saved yet
            const currentContent = page.content;
            Object.assign(page, updated);
            page.content = currentContent; // Restore in-memory content
            syncAlbumPages(page);
        }
    } catch (error) {
        console.error(`Failed to persist page ${pageId}`, error);
    }
}


function openModal({ title, content, confirmText = 'Confirm', onConfirm }) {
    modalTitleEl.textContent = title;
    modalBodyEl.innerHTML = '';
    if (typeof content === 'string') {
        modalBodyEl.innerHTML = content;
    } else if (content instanceof HTMLElement) {
        modalBodyEl.appendChild(content);
    }
    modalConfirmBtn.textContent = confirmText;
    modalEl.classList.remove('hidden');
    modalConfirmHandler = () => {
        if (onConfirm) onConfirm();
    };
}

function closeModal() {
    modalEl.classList.add('hidden');
    modalBodyEl.innerHTML = '';
    modalConfirmHandler = null;
}

function showAddPageModal() {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = 'How many pages would you like to add?';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '20';
    input.value = '1';
    input.addEventListener('input', () => input.classList.remove('input-error'));
    wrapper.appendChild(label);
    wrapper.appendChild(input);

    const albumLabel = document.createElement('label');
    albumLabel.textContent = 'Which album should they go into?';
    const albumSelect = document.createElement('select');
    state.albums.forEach(album => {
        const option = document.createElement('option');
        option.value = album.id;
        option.textContent = album.title || 'Untitled Album';
        if (album.id === state.activeAlbumId) {
            option.selected = true;
        }
        albumSelect.appendChild(option);
    });
    wrapper.appendChild(albumLabel);
    wrapper.appendChild(albumSelect);

    openModal({
        title: 'Add New Page',
        content: wrapper,
        confirmText: 'Add',
        onConfirm: async () => {
            const count = parseInt(input.value, 10);
            if (Number.isNaN(count) || count < 1) {
                input.focus();
                input.classList.add('input-error');
                return;
            }
            closeModal();
            const targetAlbumId = Number(albumSelect.value) || state.activeAlbumId;
            await addMultiplePages(count, targetAlbumId);
        }
    });
    input.focus();
}

function showAddAlbumModal() {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = 'Album Name';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g., Summer 2024';
    wrapper.appendChild(label);
    wrapper.appendChild(input);

    openModal({
        title: 'Create New Album',
        content: wrapper,
        confirmText: 'Create',
        onConfirm: async () => {
            const name = input.value.trim() || 'New Album';
            closeModal();
            const album = await createAlbum(name);
            if (album) {
                state.activeAlbumId = album.id;
                renderAlbumList();
                await createPage({ albumId: album.id });
            }
        }
    });
    input.focus();
}
async function addMultiplePages(count, albumId = state.activeAlbumId) {
    const safeCount = Math.min(count, 20);
    let lastPage = null;

    for (let i = 0; i < safeCount; i++) {
        const setActive = i === safeCount - 1;
        lastPage = await createPage({ setActive, albumId });
    }

    if (count > 20) {
        alert('You can add at most 20 pages at once. Repeat to add more.');
    }

    if (lastPage && safeCount > 1) {
        state.activePageId = lastPage.id;
        state.activeAlbumId = albumId;
        renderAlbumList();
        renderCanvas();
    }
}

function showAddTextModal() {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = 'Text Content';
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Write your memory here...';
    wrapper.appendChild(label);
    wrapper.appendChild(textarea);

    // Font Selection
    const fontLabel = document.createElement('label');
    fontLabel.textContent = 'Choose Font';
    fontLabel.style.marginTop = '1rem';
    fontLabel.style.display = 'block';
    wrapper.appendChild(fontLabel);

    const fontSelect = document.createElement('select');
    fontSelect.style.width = '100%';
    fontSelect.style.padding = '0.5rem';
    fontSelect.style.borderRadius = '8px';
    fontSelect.style.border = '1px solid #ccc';

    const defaultFonts = ['Outfit', 'Playfair Display', 'Arial', 'Courier New', 'Georgia'];
    defaultFonts.forEach(font => {
        const option = document.createElement('option');
        option.value = font;
        option.textContent = font;
        option.style.fontFamily = font;
        fontSelect.appendChild(option);
    });

    if (CUSTOM_FONTS.length > 0) {
        const group = document.createElement('optgroup');
        group.label = 'Custom Fonts';
        CUSTOM_FONTS.forEach(font => {
            const option = document.createElement('option');
            option.value = font.name;
            option.textContent = font.name;
            option.style.fontFamily = font.name;
            group.appendChild(option);
        });
        fontSelect.appendChild(group);
    }
    wrapper.appendChild(fontSelect);

    const uploadFontBtn = document.createElement('button');
    uploadFontBtn.textContent = '+ Upload Font (OTF/TTF)';
    uploadFontBtn.className = 'ghost-btn';
    uploadFontBtn.style.fontSize = '0.8rem';
    uploadFontBtn.style.marginTop = '0.5rem';
    uploadFontBtn.addEventListener('click', () => fontInput.click());
    wrapper.appendChild(uploadFontBtn);

    openModal({
        title: 'Add Text Block',
        content: wrapper,
        confirmText: 'Add',
        onConfirm: async () => {
            const text = textarea.value.trim();
            if (!text.length) {
                textarea.focus();
                return;
            }
            closeModal();
            await addBlockToActivePage('text', { text, fontFamily: fontSelect.value });
        }
    });
    textarea.focus();
}

function showAddStickerModal() {
    const wrapper = document.createElement('div');
    wrapper.className = 'sticker-picker';

    const hint = document.createElement('p');
    hint.textContent = 'Pick a favorite sticker or write your own.';
    wrapper.appendChild(hint);

    const grid = document.createElement('div');
    grid.className = 'sticker-grid';
    wrapper.appendChild(grid);

    let selected = null;

    // Default Library
    STICKER_LIBRARY.forEach((icon) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sticker-option';
        btn.textContent = icon;
        btn.addEventListener('click', () => {
            selected = icon;
            Array.from(grid.children).forEach(child => child.classList.remove('selected'));
            btn.classList.add('selected');
        });
        grid.appendChild(btn);
    });

    // Custom Stickers
    CUSTOM_STICKERS.forEach((dataUrl, index) => {
        const container = document.createElement('div');
        container.style.position = 'relative';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sticker-option';
        const img = document.createElement('img');
        img.src = dataUrl;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        btn.appendChild(img);

        btn.addEventListener('click', () => {
            selected = dataUrl; // Use dataUrl as value
            Array.from(grid.children).forEach(child => {
                if (child.tagName === 'BUTTON') child.classList.remove('selected');
                if (child.tagName === 'DIV') child.querySelector('button').classList.remove('selected');
            });
            btn.classList.add('selected');
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = '×';
        delBtn.style.position = 'absolute';
        delBtn.style.top = '-5px';
        delBtn.style.right = '-5px';
        delBtn.style.background = 'red';
        delBtn.style.color = 'white';
        delBtn.style.border = 'none';
        delBtn.style.borderRadius = '50%';
        delBtn.style.width = '18px';
        delBtn.style.height = '18px';
        delBtn.style.fontSize = '12px';
        delBtn.style.cursor = 'pointer';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Delete this sticker?')) {
                CUSTOM_STICKERS.splice(index, 1);
                localStorage.setItem('custom_stickers', JSON.stringify(CUSTOM_STICKERS));
                closeModal();
                showAddStickerModal();
            }
        });

        container.appendChild(btn);
        container.appendChild(delBtn);
        grid.appendChild(container);
    });

    // Upload Button
    const uploadBtn = document.createElement('button');
    uploadBtn.textContent = '+ Upload';
    uploadBtn.className = 'ghost-btn';
    uploadBtn.style.marginTop = '10px';
    uploadBtn.addEventListener('click', () => stickerInput.click());
    wrapper.appendChild(uploadBtn);

    const customLabel = document.createElement('label');
    customLabel.textContent = 'Or type your own sticker:';
    wrapper.appendChild(customLabel);

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.maxLength = 5;
    customInput.placeholder = 'e.g., :) or <3';
    customInput.addEventListener('input', () => customInput.classList.remove('input-error'));
    wrapper.appendChild(customInput);

    openModal({
        title: 'Choose Sticker',
        content: wrapper,
        confirmText: 'Add',
        onConfirm: async () => {
            const manual = customInput.value.trim();
            const value = manual || selected;
            if (!value) {
                customInput.classList.add('input-error');
                customInput.focus();
                return;
            }
            closeModal();
            // Check if value is dataURL (image) or text
            const type = value.startsWith('data:image') ? 'photo' : 'sticker';
            // Note: We treat custom stickers as 'photo' blocks if they are images, or 'sticker' if emoji/text
            // But user asked for "custom sticker", so maybe we should keep type as 'sticker' but handle image rendering?
            // Existing code:
            // if (block.type === 'sticker' && block.value) {
            //    const stickerEl = document.createElement('span'); ...
            // }
            // We need to update render logic to handle image stickers if type is 'sticker'

            await addBlockToActivePage('sticker', value);
        }
    });
    customInput.focus();
}

async function createAlbum(name = 'New Album') {
    try {
        const album = await createAlbumOnServer(name);
        if (!album) return null;
        const normalized = normalizeAlbum({ ...album, pages: [] });
        state.albums.push(normalized);
        state.albums.sort((a, b) => a.position - b.position);
        renderAlbumList();
        return normalized;
    } catch (error) {
        console.error('Album could not be created', error);
        alert('An error occurred while creating the album.');
    }
}

async function createAlbumOnServer(title = 'New Album') {
    const response = await apiRequest('/albums', {
        method: 'POST',
        body: { title }
    });
    return response?.album || null;
}

async function initialize() {
    console.log('App: initialize() called');

    // Check if page-flip.js loaded
    if (typeof St === 'undefined') {
        console.error('CRITICAL: PageFlip library (St) is not defined. CDN load failed?');
        alert('Error: PageFlip library could not be loaded. Please check your internet connection.');
    }

    // Load custom fonts
    CUSTOM_FONTS.forEach(async (font) => {
        try {
            const fontFace = new FontFace(font.name, `url(${font.data})`);
            await fontFace.load();
            document.fonts.add(fontFace);
        } catch (e) {
            console.error('Failed to restore font', font.name, e);
        }
    });

    try {
        await loadAlbums();
        console.log('App: loadAlbums() completed');
    } catch (e) {
        console.error('App: loadAlbums() failed', e);
    }

    attachEvents();
    initBlockers();
    initZoom();
}

// Start initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

let currentZoom = 1;

function initZoom() {
    console.log('App: initZoom() called');
    const wrapper = document.querySelector('.book-wrapper');
    const container = document.querySelector('.book-container');

    if (!wrapper || !container) return;

    wrapper.addEventListener('wheel', (e) => {
        // Prevent default browser scroll to allow pure zooming
        e.preventDefault();

        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        currentZoom = Math.min(Math.max(0.5, currentZoom + delta), 3);

        container.style.transform = `scale(${currentZoom})`;
    }, { passive: false });
}


function enableBlockRotation(blockEl, block, page, handle) {
    if (!handle) return;

    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const pointerId = event.pointerId;
        if (handle.setPointerCapture) {
            try {
                handle.setPointerCapture(pointerId);
            } catch (err) {
                // ignore
            }
        }

        handle.style.cursor = 'grabbing';
        blockEl.classList.add('page-block--rotating');

        // Calculate center of the block
        const rect = blockEl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Calculate initial angle offset
        // We want to maintain the relative angle between the mouse and the block's current rotation
        const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
        const initialRotation = (block.rotation || 0) * (Math.PI / 180);
        const angleOffset = startAngle - initialRotation;

        const onMove = (moveEvent) => {
            if (moveEvent.pointerId !== pointerId) return;

            const currentAngle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX);
            let rotation = (currentAngle - angleOffset) * (180 / Math.PI);

            // Normalize to 0-360
            rotation = (rotation + 360) % 360;

            block.rotation = rotation;
            blockEl.style.transform = `rotate(${rotation}deg)`;
        };

        const release = () => {
            handle.style.cursor = 'grab';
            blockEl.classList.remove('page-block--rotating');
            if (page?.id) {
                scheduleSave(page.id);
            }
        };

        const cleanup = () => {
            if (handle.releasePointerCapture) {
                try {
                    handle.releasePointerCapture(pointerId);
                } catch (err) {
                    // ignore
                }
            }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
            release();
        };

        const onUp = (upEvent) => {
            if (upEvent.pointerId !== pointerId) return;
            cleanup();
        };

        const onCancel = (cancelEvent) => {
            if (cancelEvent.pointerId && cancelEvent.pointerId !== pointerId) return;
            cleanup();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
    });
}


function initBlockers() {
    // Stop propagation of events on blockers to prevent underlying page flip from triggering
    const events = ['mousedown', 'mousemove', 'mouseup', 'click', 'pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend'];

    document.querySelectorAll('.blocker').forEach(el => {
        events.forEach(evt => {
            el.addEventListener(evt, (e) => {
                // We are on the opaque part of the blocker (due to clip-path hole)
                // Stop event from reaching the book canvas
                e.preventDefault();
                e.stopPropagation();
            }, { passive: false });
        });
    });
}

// Helper: Remove block
function removeBlock(pageId, blockId) {
    const page = state.pages.find(p => p.id === pageId);
    if (!page) return;

    page.content = page.content.filter(b => b.id !== blockId);
    scheduleSave(pageId);
    renderCanvas();
}

// Helper: Apply styles to block element
function applyBlockStyles(blockEl, block) {
    blockEl.style.left = `${block.x}px`;
    blockEl.style.top = `${block.y}px`;
    blockEl.style.width = block.width ? `${block.width}px` : 'auto';
    blockEl.style.height = block.height ? `${block.height}px` : 'auto';
    blockEl.style.zIndex = block.zIndex || 1;
    blockEl.style.transform = `rotate(${block.rotation || 0}deg)`;
}

// Enable dragging for a block
// Enable dragging for a block
function enableBlockDrag(blockEl, block, container, page) {
    blockEl.addEventListener('pointerdown', (e) => {
        // Ignore if clicking on controls or if not primary button
        if (e.target.closest('.block-control') || e.target.closest('.block-resize-handle') || e.target.closest('.block-actions button') || e.button !== 0) return;

        e.preventDefault(); // Prevent text selection/scrolling
        e.stopPropagation();

        const pointerId = e.pointerId;

        // Capture pointer to ensure we receive events even if processing leaves the element
        try {
            blockEl.setPointerCapture(pointerId);
        } catch (err) {
            // Ignore capture failure
        }

        blockEl.classList.add('page-block--dragging');

        // Initial state
        const startX = e.clientX;
        const startY = e.clientY;
        const initialLeft = block.x;
        const initialTop = block.y;

        // Bring to front
        bringBlockToFront(blockEl, block);

        const onMove = (moveEvent) => {
            if (moveEvent.pointerId !== pointerId) return;

            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;

            let newX = initialLeft + dx;
            let newY = initialTop + dy;

            block.x = newX;
            block.y = newY;

            blockEl.style.left = `${newX}px`;
            blockEl.style.top = `${newY}px`;
        };

        const onUp = (upEvent) => {
            if (upEvent.pointerId !== pointerId) return;
            cleanup();
        };

        const onCancel = (cancelEvent) => {
            if (cancelEvent.pointerId !== pointerId) return;
            cleanup();
        };

        const cleanup = () => {
            blockEl.classList.remove('page-block--dragging');

            try {
                if (blockEl.hasPointerCapture(pointerId)) {
                    blockEl.releasePointerCapture(pointerId);
                }
            } catch (err) {
                // ignore
            }

            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);

            scheduleSave(page.id);
        };

        // Attach global listeners for drag logic
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
    });
}

function bringBlockToFront(blockEl, block) {
    const allBlocks = Array.from(document.querySelectorAll('.page-block'));
    const maxZ = allBlocks.reduce((max, el) => Math.max(max, parseInt(el.style.zIndex || 1)), 0);
    block.zIndex = maxZ + 1;
    blockEl.style.zIndex = block.zIndex;
}

// Enable resizing
function enableBlockResize(blockEl, block, container, page, handle) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        bringBlockToFront(blockEl, block);
        const pointerId = event.pointerId;
        if (handle.setPointerCapture) {
            try {
                handle.setPointerCapture(pointerId);
            } catch (err) {
                // ignore capture errors
            }
        }
        blockEl.classList.add('page-block--resizing');

        const containerRect = container.getBoundingClientRect();
        const startWidth = blockEl.offsetWidth;
        const startHeight = blockEl.offsetHeight;
        const aspectRatio = startWidth / startHeight;
        const startX = event.clientX;
        const startY = event.clientY;

        let startFontSize = 16;
        if (block.type === 'text') {
            const textEl = blockEl.querySelector('div[contenteditable="true"]') || blockEl.querySelector('div');
            if (textEl) {
                startFontSize = parseFloat(window.getComputedStyle(textEl).fontSize) || 16;
            }
        }

        const minWidth = block.type === 'sticker' ? 40 : 100;
        const minHeight = block.type === 'sticker' ? 40 : 40;

        const onMove = (moveEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            const deltaX = moveEvent.clientX - startX;

            let newWidth, newHeight;

            if (block.type === 'text') {
                const deltaY = moveEvent.clientY - startY;
                const dominantDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
                const newFontSize = Math.max(12, Math.min(120, startFontSize + (dominantDelta / 3)));

                const textEl = blockEl.querySelector('div');
                if (textEl) {
                    textEl.style.fontSize = `${newFontSize}px`;
                    block.fontSize = newFontSize;
                }
            } else {
                const maxWidth = Math.max(minWidth, containerRect.width - (block.x || 0));
                newWidth = clamp(startWidth + deltaX, minWidth, maxWidth);
                newHeight = newWidth / aspectRatio;

                blockEl.style.width = `${newWidth}px`;
                blockEl.style.height = `${newHeight}px`;

                const stickerEl = blockEl.querySelector('.sticker-emoji');
                if (stickerEl) {
                    stickerEl.style.fontSize = `${newHeight * 0.8}px`;
                }
            }
        };

        const release = () => {
            blockEl.classList.remove('page-block--resizing');
            if (block.type === 'text') {
                const textEl = blockEl.querySelector('div');
                if (textEl) {
                    block.fontSize = parseFloat(textEl.style.fontSize);
                }
            } else {
                block.width = parseFloat(blockEl.style.width) || blockEl.offsetWidth;
                block.height = parseFloat(blockEl.style.height) || blockEl.offsetHeight;
            }
            if (page?.id) {
                scheduleSave(page.id);
            }
        };

        const cleanup = () => {
            if (handle.releasePointerCapture) {
                try {
                    handle.releasePointerCapture(pointerId);
                } catch (err) {
                }
            }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
            release();
        };

        const onUp = (upEvent) => {
            if (upEvent.pointerId !== pointerId) return;
            cleanup();
        };

        const onCancel = (cancelEvent) => {
            if (cancelEvent.pointerId && cancelEvent.pointerId !== pointerId) return;
            cleanup();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
    });
}

async function addBlockToPage(pageId, type, value, options = {}) {
    const page = state.pages.find(p => p.id === pageId);
    if (!page) return;

    if (type === 'photo' && typeof value === 'string' && value.startsWith('data:image') && !options.width) {
        try {
            const dims = await getImageDimensions(value);
            // reused scale logic from addBlockToActivePage could go here or getBlockDefaults handles it
            // For now, let createBlock/getBlockDefaults handle default photo resizing unless we want strict logic
        } catch (e) {
            console.error('Failed to get dims', e);
        }
    }

    const block = createBlock(type, value, page, options);
    page.content = Array.isArray(page.content) ? [...page.content, block] : [block];

    // Check if we need to re-render. If it's visible, yes.
    // Ideally update in-place or re-render canvas.
    renderCanvas();
    scheduleSave(page.id);
}

function enablePageDrop(container, page) {
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        container.classList.add('page-content--dragover');
    });

    container.addEventListener('dragleave', () => {
        container.classList.remove('page-content--dragover');
    });

    container.addEventListener('drop', async (e) => {
        e.preventDefault();
        container.classList.remove('page-content--dragover');

        const dataRaw = e.dataTransfer.getData('application/json');
        if (!dataRaw) return;

        try {
            const data = JSON.parse(dataRaw);
            if (data.type === 'sticker' || data.type === 'photo') {
                const rect = container.getBoundingClientRect();

                // Calculate scale
                const scaleX = rect.width / container.offsetWidth;
                const scaleY = rect.height / container.offsetHeight;

                // Mouse pos relative to container
                const rawX = e.clientX - rect.left;
                const rawY = e.clientY - rect.top;

                // CSS coordinates
                const x = rawX / scaleX;
                const y = rawY / scaleY;

                const kSize = data.type === 'sticker' ? 80 : 300; // Larger default for photos

                // For photos, we might want to get aspect ratio if possible, but async here is tricky
                // addBlockToActivePage handles resizing if it's a photo type and we pass just value?
                // But addBlockToPage takes explicit coordinates.
                // Best approach: Use addBlockToPage but let it calculate dimensions if needed.
                // Actually addBlockToPage calls spread.pages.find... then pushes block.
                // We should reuse addBlockToActivePage logic or enhance addBlockToPage.
                // addBlockToPage is simple. Let's use addBlockToActivePage-like logic but with coordinates.

                if (data.type === 'photo') {
                    // We need dimensions. 
                    const img = new Image();
                    img.onload = async () => {
                        const aspect = img.naturalWidth / img.naturalHeight;
                        const width = 300;
                        const height = width / aspect;

                        await addBlockToPage(page.id, 'photo', data.value, {
                            x: Math.max(0, x - width / 2),
                            y: Math.max(0, y - height / 2),
                            width,
                            height
                        });
                    };
                    img.src = data.value;
                } else {
                    await addBlockToPage(page.id, 'sticker', data.value, {
                        x: Math.max(0, x - kSize / 2),
                        y: Math.max(0, y - kSize / 2)
                    });
                }
            }
        } catch (err) {
            console.error('Drop handling failed', err);
        }
    });
}
