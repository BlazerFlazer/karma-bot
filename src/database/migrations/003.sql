CREATE TABLE roster_panels(guild TEXT PRIMARY KEY REFERENCES guild_settings,channel TEXT NOT NULL,message TEXT NOT NULL,page INTEGER NOT NULL DEFAULT 0);
CREATE TABLE audit_delivery(guild TEXT PRIMARY KEY REFERENCES guild_settings,cursor INTEGER NOT NULL DEFAULT 0);
CREATE INDEX audit_expiry ON audit_logs(guild,time);
CREATE INDEX ticket_retention ON tickets(guild,closed);
CREATE INDEX member_history_time ON member_history(guild,time);
