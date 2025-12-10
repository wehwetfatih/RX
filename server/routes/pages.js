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
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : 'Untitled Page';
        const content = JSON.stringify(parseContent(req.body?.content));
        const incomingPosition = Number.isInteger(req.body?.position) ? req.body.position : null;
        const requestedAlbum = Number(req.body?.albumId);
        const incomingAlbum = Number.isInteger(requestedAlbum) && requestedAlbum > 0
            ? requestedAlbum
            : null;

        let resolvedAlbumId = null;
        let resolvedPosition = incomingPosition;

        if (incomingAlbum !== null) {
            resolvedAlbumId = await resolveAlbumId(incomingAlbum);
            if (resolvedPosition === null) {
                const nextRows = await sql`
                    SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
                    FROM public.pages
                    WHERE album_id = ${resolvedAlbumId}
                `;
                resolvedPosition = nextRows[0]?.next_pos || 1;
            }
        }

        const assignments = ['title = $1', 'content = $2'];
        const params = [title || 'Untitled Page', content];

        if (resolvedPosition !== null) {
            assignments.push(`position = $${assignments.length + 1}`);
            params.push(resolvedPosition);
        }

        if (resolvedAlbumId !== null) {
            assignments.push(`album_id = $${assignments.length + 1}`);
            params.push(resolvedAlbumId);
        }

        params.push(id);
        const setClause = assignments.join(', ');
        const query = `
            UPDATE public.pages
            SET ${setClause}
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
        res.status(500).json({ error: 'Unable to update page' });
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
