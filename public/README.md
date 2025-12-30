# MemoryForge

Modern photo-memory booklet rebuilt from the ground up. The project now ships with a full Express API backed by Postgres (Supabase friendly) and a redesigned single-page client for managing story pages, text, and photos.

## Project Layout

```
booklet/
├── public/               # Front-end assets served by Express
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── server/
│   ├── index.js          # Express bootstrap
│   ├── config.js         # Environment + server config
│   ├── db/
│   │   ├── db.js         # Postgres/Supabase connection helper
│   │   ├── ensure.js     # Applies schema.sql on boot
│   │   └── schema.sql    # Starter SQL script for tables + trigger
│   └── routes/pages.js   # RESTful page endpoints
├── .env.example          # Environment template (copy to .env)
├── package.json
└── package-lock.json
```

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Provision Postgres / Supabase**
   - Create a database (e.g., `MemoryBook`) in Postgres or Supabase.
   - Run `server/db/schema.sql` to create the `pages` table and trigger.

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Set DATABASE_URL to your Postgres / Supabase connection string
   ```

4. **Run the server**
   ```bash
   npm run dev
   # or
   npm start
   ```
   The app serves at `http://localhost:4000` by default.

## API Overview

| Method | Endpoint         | Description                         |
| ------ | ---------------- | ----------------------------------- |
| GET    | `/api/pages`     | List all pages with ordered blocks  |
| POST   | `/api/pages`     | Create a new page                   |
| PUT    | `/api/pages/:id` | Update a page's title/content/order |
| DELETE | `/api/pages/:id` | Remove a page                       |

The client automatically calls these endpoints; you can integrate other tools using the same payload structure defined in `server/routes/pages.js`.

## Front-End Features

- Clean split layout with a purple-to-pink gradient background.
- Sidebar page navigator with hover preview, active indicator, and inline reordering.
- Rich toolbar for adding text snippets or uploading inline photos (stored as base64 strings in Postgres).
- Immediate persistence: every edit triggers a debounced API update, so reloading keeps your last state.
- Per-page delete button plus confirmation modal to avoid accidental wipes.

Happy storytelling!
