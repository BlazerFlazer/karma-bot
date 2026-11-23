CREATE TABLE admission_claims(guild TEXT NOT NULL REFERENCES guild_settings,static TEXT NOT NULL,user TEXT NOT NULL,ticket INTEGER UNIQUE NOT NULL REFERENCES tickets ON DELETE CASCADE,PRIMARY KEY(guild,static),UNIQUE(guild,user));
ALTER TABLE tickets ADD COLUMN first_responder TEXT;
UPDATE tickets SET first_responder=assignee WHERE first_response IS NOT NULL;
