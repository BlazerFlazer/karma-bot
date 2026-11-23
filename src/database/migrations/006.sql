ALTER TABLE control_publications ADD COLUMN snapshot TEXT NOT NULL DEFAULT '{}';
CREATE INDEX control_publication_message ON control_publications(guild,channel,message);
CREATE INDEX control_notes_ticket ON control_notes(ticket,id);
