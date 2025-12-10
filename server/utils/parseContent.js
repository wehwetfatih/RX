function parseContent(payload) {
    if (Array.isArray(payload)) return payload;
    if (typeof payload === 'string') {
        try {
            const parsed = JSON.parse(payload);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

module.exports = parseContent;
