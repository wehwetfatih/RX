const fs = require('fs');
const path = require('path');
const sql = require('./db');

async function ensureSchema() {
    // Skip database initialization if no database is configured
    if (!sql) {
        return;
    }

    const schemaPath = path.join(__dirname, 'schema.sql');

    if (!fs.existsSync(schemaPath)) return;

    const fileContent = fs.readFileSync(schemaPath, 'utf-8').trim();
    if (!fileContent.length) return;

    await sql.unsafe(fileContent);
}

module.exports = ensureSchema;
