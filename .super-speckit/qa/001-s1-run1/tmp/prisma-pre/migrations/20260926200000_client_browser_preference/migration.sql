-- Desktop-only preference: when on, this user's bots are denied the VM browser
-- tools (js, browser_navigate, browser_snapshot, browser_act) and must drive
-- the client Browser pane via client_js instead.
ALTER TABLE "user" ADD COLUMN "clientBrowserPreferred" BOOLEAN NOT NULL DEFAULT false;
