const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const dbPath = './data/booklet.db';
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database.');
});

async function extract() {
    db.serialize(() => {
        db.all("SELECT * FROM pages", [], (err, rows) => {
            if (err) {
                console.error("Error getting pages:", err);
            } else {
                console.log("PAGES_DATA_FOUND:", JSON.stringify(rows, null, 2));
            }
            db.close();
        });
    });
}

extract();
