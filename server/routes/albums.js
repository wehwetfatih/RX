const express = require('express');
const router = express.Router();
const sql = require('../db/db');
const parseContent = require('../utils/parseContent');

router.get('/', async (req, res) => {
    try {
        const albumRows = await sql`
            SELECT id, title, position
            FROM public.albums
            ORDER BY position ASC
        `;

        const pageRows = await sql`
            SELECT id, title, content, position, album_id
            FROM public.pages
            ORDER BY album_id ASC, position ASC
        `;

        const albumMap = new Map(
            albumRows.map(album => [album.id, {
                id: album.id,
                title: album.title,
                position: album.position,
                pages: []
            }])
        );

        pageRows.forEach(page => {
            const album = albumMap.get(page.album_id);
            if (!album) return;
            album.pages.push({
                id: page.id,
                title: page.title,
                position: page.position,
                albumId: page.album_id,
                content: parseContent(page.content)
            });
        });

        res.json({ albums: Array.from(albumMap.values()) });
    } catch (error) {
        console.error('GET /api/albums failed:', error);
        res.status(500).json({ error: 'Unable to fetch albums' });
    }
});

router.post('/', async (req, res) => {
    try {
        const title = typeof req.body?.title === 'string' && req.body.title.trim().length
            ? req.body.title.trim()
            : 'New Album';

        const nextRows = await sql`
            SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
            FROM public.albums
        `;
        const nextPosition = nextRows[0]?.next_pos || 1;

        const [album] = await sql`
            INSERT INTO public.albums (title, position)
            VALUES (${title}, ${nextPosition})
            RETURNING id, title, position
        `;

        res.status(201).json({
            album: {
                id: album.id,
                title: album.title,
                position: album.position,
                pages: []
            }
        });
    } catch (error) {
        console.error('POST /api/albums failed:', error);
        res.status(500).json({ error: 'Unable to create album' });
    }
});

router.put('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid album id' });
    }

    try {
        const title = typeof req.body?.title === 'string' && req.body.title.trim().length
            ? req.body.title.trim()
            : null;

        if (!title) {
            return res.status(400).json({ error: 'Album title is required' });
        }

        const [album] = await sql`
            UPDATE public.albums
            SET title = ${title}
            WHERE id = ${id}
            RETURNING id, title, position
        `;

        if (!album) {
            return res.status(404).json({ error: 'Album not found' });
        }

        res.json({
            album: {
                id: album.id,
                title: album.title,
                position: album.position
            }
        });

    } catch (error) {
        console.error('PUT /api/albums/:id failed:', error);
        res.status(500).json({ error: 'Unable to update album' });
    }
});

router.put('/:id/reorder', async (req, res) => {
    const id = Number(req.params.id);
    const { pageIds } = req.body;

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid album id' });
    }
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
        return res.status(400).json({ error: 'pageIds array is required' });
    }

    try {
        await sql.begin(async sql => {
            // 1. Verify all pages belong to this album
            const pages = await sql`
                SELECT id FROM public.pages 
                WHERE album_id = ${id} AND id IN ${sql(pageIds)}
            `;

            if (pages.length !== pageIds.length) {
                throw new Error('Some pages do not belong to this album');
            }

            // 2. Safe Reorder Strategy:
            // Since (album_id, position) is unique, we can't simple swap or shift directly without risking collision.
            // Strategy: Update to negative temporary positions first, then to correct positive positions.

            // Step A: Update to temporary negative positions (-1, -2, -3...) based on requested order
            // We use a CTE or creating a VALUES list to map id -> new_temp_position

            const values = pageIds.map((pageId, index) => ({
                id: pageId,
                temp_pos: -(index + 1), // -1, -2, -3...
                final_pos: index // 0, 1, 2...
            }));

            // We must execute these updates. 
            // Postgres `UPDATE ... FROM (VALUES ...)` is powerful.

            // First pass: Set to negative values to free up the positive namespace
            for (const { id: pId, temp_pos } of values) {
                await sql`
                    UPDATE public.pages 
                    SET position = ${temp_pos}
                    WHERE id = ${pId}
                `;
            }

            // Second pass: Set to final positive values
            for (const { id: pId, final_pos } of values) {
                await sql`
                    UPDATE public.pages 
                    SET position = ${final_pos}
                    WHERE id = ${pId}
                `;
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('PUT /api/albums/:id/reorder failed:', error);
        res.status(500).json({
            error: 'Unable to reorder pages',
            details: error.message
        });
    }
});

router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid album id' });
    }

    try {
        const deleted = await sql`
            DELETE FROM public.albums
            WHERE id = ${id}
            RETURNING id
        `;

        if (!deleted.length) {
            return res.status(404).json({ error: 'Album not found' });
        }

        await sql`
            WITH ordered AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC) AS new_position
                FROM public.albums
            )
            UPDATE public.albums AS a
            SET position = ordered.new_position
            FROM ordered
            WHERE ordered.id = a.id
        `;

        res.json({ success: true });
    } catch (error) {
        console.error('DELETE /api/albums/:id failed:', error);
        res.status(500).json({ error: 'Unable to delete album' });
    }
});

module.exports = router;
