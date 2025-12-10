-- Supabase/Postgres friendly schema for albums + pages

CREATE TABLE IF NOT EXISTS public.albums (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL DEFAULT 'New Album',
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_albums_position ON public.albums (position);

CREATE OR REPLACE FUNCTION public.set_albums_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc', NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_albums_update ON public.albums;

CREATE TRIGGER trg_albums_update
BEFORE UPDATE ON public.albums
FOR EACH ROW
EXECUTE FUNCTION public.set_albums_updated_at();

CREATE TABLE IF NOT EXISTS public.pages (
    id BIGSERIAL PRIMARY KEY,
    album_id BIGINT,
    title VARCHAR(200) NOT NULL DEFAULT 'Untitled Page',
    content TEXT NOT NULL DEFAULT '[]',
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.pages
    ADD COLUMN IF NOT EXISTS album_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.albums) THEN
        INSERT INTO public.albums (title, position) VALUES ('First Album', 1);
    END IF;
END;
$$;

WITH fallback AS (
    SELECT id FROM public.albums ORDER BY position ASC LIMIT 1
)
UPDATE public.pages
SET album_id = fallback.id
FROM fallback
WHERE public.pages.album_id IS NULL;

ALTER TABLE public.pages
    ALTER COLUMN album_id SET NOT NULL;

ALTER TABLE public.pages
    DROP CONSTRAINT IF EXISTS pages_album_id_fkey;

ALTER TABLE public.pages
    ADD CONSTRAINT pages_album_id_fkey
    FOREIGN KEY (album_id)
    REFERENCES public.albums(id)
    ON DELETE CASCADE;

DROP INDEX IF EXISTS ux_pages_position;
CREATE UNIQUE INDEX IF NOT EXISTS ux_pages_album_position ON public.pages (album_id, position);

CREATE OR REPLACE FUNCTION public.set_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc', NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pages_update ON public.pages;

CREATE TRIGGER trg_pages_update
BEFORE UPDATE ON public.pages
FOR EACH ROW
EXECUTE FUNCTION public.set_pages_updated_at();
