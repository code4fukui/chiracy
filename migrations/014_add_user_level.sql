ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1
  CHECK (level BETWEEN 1 AND 3);

UPDATE users
SET level = 2
WHERE EXISTS (SELECT 1 FROM plans WHERE plans.user_id = users.id);

UPDATE users
SET level = 3
WHERE EXISTS (SELECT 1 FROM flyers WHERE flyers.user_id = users.id)
   OR EXISTS (SELECT 1 FROM sites WHERE sites.user_id = users.id);
