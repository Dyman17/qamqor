-- Emails are compared in lower case everywhere in the API. Normalise existing rows.
-- Rows whose lower-cased address would collide with another user are left untouched
-- (the unique index would reject them); resolve such pairs by hand.
UPDATE "users" u
SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND NOT EXISTS (
    SELECT 1 FROM "users" o WHERE o."id" <> u."id" AND lower(o."email") = lower(u."email")
  );
