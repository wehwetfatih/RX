const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envCandidates = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '.env'),
    path.join(__dirname, 'db', '.env')
];

for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        break;
    }
}

module.exports = {
    port: parseInt(process.env.PORT || '4000', 10),
    databaseUrl: process.env.DATABASE_URL || ''
};
