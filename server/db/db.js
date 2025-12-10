const config = require('../config');

const connectionString = config.databaseUrl;

// If no DATABASE_URL is configured, export null to allow app to run with localStorage only
if (!connectionString) {
    console.warn('⚠️  DATABASE_URL not configured. Running in localStorage-only mode.');
    module.exports = null;
} else {
    try {
        const postgres = require('postgres');
        const options = {};
        if (/supabase\.co/i.test(connectionString)) {
            options.ssl = { rejectUnauthorized: false };
        }

        const sql = postgres(connectionString, options);
        module.exports = sql;
    } catch (error) {
        console.error('Failed to initialize database connection:', error.message);
        module.exports = null;
    }
}

