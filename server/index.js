const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const ensureSchema = require('./db/ensure');

const pagesRouter = require('./routes/pages');
const albumsRouter = require('./routes/albums');
const sql = require('./db/db');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Middleware: If database is not configured, return 501 for API routes
app.use('/api', (req, res, next) => {
    if (!sql) {
        return res.status(501).json({
            error: 'Database not configured',
            message: 'This app is running in localStorage-only mode. API endpoints are not available.'
        });
    }
    next();
});

app.use('/api/pages', pagesRouter);
app.use('/api/albums', albumsRouter);

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

app.get(/.*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

async function startServer() {
    try {
        await ensureSchema();
        app.listen(config.port, () => {
            console.log(`MemoryForge server running at http://localhost:${config.port}`);
            if (!config.databaseUrl) {
                console.log('📦 Running in localStorage-only mode (no database configured)');
            } else {
                console.log('✅ Database connected');
            }
        });
    } catch (error) {
        console.error('Failed to initialize database schema:', error);
        process.exit(1);
    }
}

startServer();
