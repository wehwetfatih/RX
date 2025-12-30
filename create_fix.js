
const fs = require('fs');
const path = 'public/app.js';
const newPath = 'public/app_fix.js'; // New filename

try {
    // Read original content
    let content = fs.readFileSync(path, 'utf8');

    // Append function if missing
    if (!content.includes('function renderTextContent(container)')) {
        const functionCode = `
function renderTextContent(container) {
    const wrapper = document.createElement('div');
    wrapper.style.padding = '10px';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '10px';

    const title = document.createElement('h3');
    title.innerText = 'Add Text';
    wrapper.appendChild(title);

    const textArea = document.createElement('textarea');
    textArea.placeholder = 'Type text here...';
    textArea.style.width = '100%';
    textArea.style.minHeight = '100px';
    textArea.style.padding = '8px';
    textArea.style.border = '1px solid #ccc';
    textArea.style.borderRadius = '4px';
    wrapper.appendChild(textArea);

    const fontLabel = document.createElement('label');
    fontLabel.innerText = 'Font:';
    wrapper.appendChild(fontLabel);

    const fontSelect = document.createElement('select');
    fontSelect.style.width = '100%';
    fontSelect.style.padding = '8px';
    const fonts = ['Outfit', 'Playfair Display', 'Pacifico', 'Dancing Script', 'Arial', 'Times New Roman'];
    fonts.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.innerText = f;
        fontSelect.appendChild(opt);
    });
    if (typeof CUSTOM_FONTS !== 'undefined') {
        CUSTOM_FONTS.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.name;
            opt.innerText = f.name + ' (Custom)';
            fontSelect.appendChild(opt);
        });
    }
    wrapper.appendChild(fontSelect);
    
    fontSelect.onchange = () => textArea.style.fontFamily = fontSelect.value;
    textArea.style.fontFamily = fontSelect.value;

    const addBtn = document.createElement('button');
    addBtn.innerText = 'Add Text';
    addBtn.className = 'tool-btn primary';
    addBtn.style.marginTop = '10px';
    addBtn.onclick = async () => {
        if (!textArea.value.trim()) return alert('Enter text');
        const activePage = (typeof getActivePage === 'function') ? getActivePage() : null;
        if (!activePage) return alert('Select a page');
        
        try {
            await addBlockToActivePage('text', {
                text: textArea.value,
                fontFamily: fontSelect.value
            });
        } catch(e) { console.error(e); alert('Error adding text'); }
    };
    wrapper.appendChild(addBtn);
    
    const uploadBtn = document.createElement('button');
    uploadBtn.innerText = 'Upload Style';
    uploadBtn.className = 'tool-btn secondary';
    uploadBtn.style.marginTop = '10px';
    uploadBtn.onclick = () => document.getElementById('font-input')?.click();
    wrapper.appendChild(uploadBtn);

    container.appendChild(wrapper);
}
`;
        content += '\n' + functionCode;
    }

    // Write to NEW file
    fs.writeFileSync(newPath, content, 'utf8');
    console.log('Created ' + newPath);

} catch (error) {
    console.error('Error:', error);
}
