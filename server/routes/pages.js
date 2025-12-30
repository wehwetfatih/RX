const express = require('express');
const router = express.Router();
const sql = require('../db/db');
const parseContent = require('../utils/parseContent');

async function resolveAlbumId(requestedId) {
    if (Number.isInteger(requestedId) && requestedId > 0) {
        const existing = await sql`
            SELECT id FROM public.albums WHERE id = ${requestedId} LIMIT 1
        `;
        if (existing.length) {
            return existing[0].id;
        }
    }

    const fallback = await sql`
        SELECT id FROM public.albums ORDER BY position ASC LIMIT 1
    `;

    if (fallback.length) {
        return fallback[0].id;
    }

    const nextRows = await sql`
        SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
        FROM public.albums
    `;
    const nextPosition = nextRows[0]?.next_pos || 1;
    const [album] = await sql`
        INSERT INTO public.albums (title, position)
        VALUES ('New Album', ${nextPosition})
        RETURNING id
    `;
    return album.id;
}

router.get('/', async (req, res) => {
    try {
        const rows = await sql`
            SELECT id, title, content, position, album_id
            FROM public.pages
            ORDER BY album_id ASC, position ASC
        `;
        const pages = rows.map(row => ({
            id: row.id,
            title: row.title,
            position: row.position,
            albumId: row.album_id,
            content: parseContent(row.content)
        }));
        res.json({ pages });
    } catch (error) {
        console.error('GET /api/pages failed:', error);
        res.status(500).json({ error: 'Unable to fetch pages' });
    }
});

router.post('/', async (req, res) => {
    try {
        const title = typeof req.body?.title === 'string' && req.body.title.trim().length
            ? req.body.title.trim()
            : 'Untitled Page';
        const incomingContent = parseContent(req.body?.content);
        const requestedAlbumId = Number(req.body?.albumId);
        const albumId = await resolveAlbumId(
            Number.isInteger(requestedAlbumId) && requestedAlbumId > 0 ? requestedAlbumId : null
        );

        const nextRows = await sql`
            SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
            FROM public.pages
            WHERE album_id = ${albumId}
        `;
        const nextPosition = nextRows[0]?.next_pos || 1;

        const [page] = await sql`
            INSERT INTO public.pages (title, content, position, album_id)
            VALUES (${title}, ${JSON.stringify(incomingContent)}, ${nextPosition}, ${albumId})
            RETURNING id, title, content, position, album_id
        `;

        res.status(201).json({
            page: {
                id: page.id,
                title: page.title,
                position: page.position,
                albumId: page.album_id,
                content: parseContent(page.content)
            }
        });
    } catch (error) {
        console.error('POST /api/pages failed:', error);
        res.status(500).json({ error: 'Unable to create page' });
    }
});

router.put('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid page id' });
    }

    try {
        // Collect updates conditionally
        const updates = {};

        if (req.body.title !== undefined) {
            updates.title = typeof req.body.title === 'string' ? req.body.title.trim() : 'Untitled Page';
        }

        if (req.body.content !== undefined) {
            updates.content = JSON.stringify(parseContent(req.body.content));
        }

        const incomingPosition = Number.isInteger(req.body.position) ? req.body.position : null;
        if (incomingPosition !== null) {
            updates.position = incomingPosition;
        }

        const requestedAlbum = Number(req.body.albumId);
        const incomingAlbum = Number.isInteger(requestedAlbum) && requestedAlbum > 0 ? requestedAlbum : null;

        if (incomingAlbum !== null) {
            const resolvedAlbumId = await resolveAlbumId(incomingAlbum);
            updates.album_id = resolvedAlbumId;

            // If moving to a new album and position not specified, append to end
            if (updates.position === undefined) {
                const nextRows = await sql`
                    SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
                    FROM public.pages
                    WHERE album_id = ${resolvedAlbumId}
                `;
                updates.position = nextRows[0]?.next_pos || 1;
            }
        }

        const keys = Object.keys(updates);
        if (keys.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const assignments = [];
        const params = [];

        keys.forEach((key, index) => {
            assignments.push(`${key} = $${index + 1}`);
            params.push(updates[key]);
        });

        params.push(id); // ID is the last param

        const query = `
            UPDATE public.pages
            SET ${assignments.join(', ')}
            WHERE id = $${params.length}
            RETURNING id, title, content, position, album_id;
        `;

        const result = await sql.unsafe(query, params);
        if (!result.length) {
            return res.status(404).json({ error: 'Page not found' });
        }

        const updated = result[0];
        res.json({
            page: {
                id: updated.id,
                title: updated.title,
                position: updated.position,
                albumId: updated.album_id,
                content: parseContent(updated.content)
            }
        });
    } catch (error) {
        console.error('PUT /api/pages/:id failed:', error);
        res.status(500).json({
            error: 'Unable to update page',
            details: error.message,
            code: error.code
        });
    }
});

router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid page id' });
    }

    try {
        const deleted = await sql`
            DELETE FROM public.pages
            WHERE id = ${id}
            RETURNING album_id
        `;

        if (!deleted.length) {
            return res.status(404).json({ error: 'Page not found' });
        }

        await sql`
            WITH ordered AS (
                SELECT id, album_id, ROW_NUMBER() OVER (PARTITION BY album_id ORDER BY position ASC) AS new_position
                FROM public.pages
            )
            UPDATE public.pages AS p
            SET position = ordered.new_position
            FROM ordered
            WHERE ordered.id = p.id;
        `;

        res.json({ success: true });
    } catch (error) {
        console.error('DELETE /api/pages/:id failed:', error);
        res.status(500).json({ error: 'Unable to delete page' });
    }
});

module.exports = router;
