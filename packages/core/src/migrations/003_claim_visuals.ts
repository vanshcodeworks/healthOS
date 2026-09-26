import type { Migration } from "../db.js";

export const claimVisuals: Migration = {
  id: 3,
  name: "claim_visuals",
  sql: `
-- 003: first-class columns for a claim's review metadata.
--
-- Until now the permitted and forbidden phrasing of a claim had nowhere proper to
-- live and was smuggled through risk_flags as 'permit:'/'forbid:' prefixed
-- strings. That made a reviewed constraint indistinguishable from a risk label,
-- and it left the approved figures, caveats and visual hints unpersisted, so a
-- storyboard rebuilt from the database could not know which numbers a reviewer
-- had actually signed off on.
--
-- The prefixed rows are migrated into their own columns and left in place, so a
-- rollback does not lose the phrasing.

ALTER TABLE claims ADD COLUMN permitted_phrasing   TEXT NOT NULL DEFAULT '[]';
ALTER TABLE claims ADD COLUMN forbidden_phrasing   TEXT NOT NULL DEFAULT '[]';
ALTER TABLE claims ADD COLUMN figures             TEXT NOT NULL DEFAULT '[]';
ALTER TABLE claims ADD COLUMN caveat              TEXT NOT NULL DEFAULT '';
ALTER TABLE claims ADD COLUMN visual_hints        TEXT NOT NULL DEFAULT '[]';
ALTER TABLE claims ADD COLUMN visual_strategy_hint TEXT;

-- Split the smuggled phrasings out of risk_flags. Anything that is not a
-- permit:/forbid: prefix is a genuine risk label and stays untouched.
UPDATE claims
SET permitted_phrasing = COALESCE(
       (SELECT json_group_array(substr(value, 8))
          FROM json_each(claims.risk_flags)
         WHERE value LIKE 'permit:%'),
       '[]'),
    forbidden_phrasing = COALESCE(
       (SELECT json_group_array(substr(value, 8))
          FROM json_each(claims.risk_flags)
         WHERE value LIKE 'forbid:%'),
       '[]'),
    risk_flags = COALESCE(
       (SELECT json_group_array(value)
          FROM json_each(claims.risk_flags)
         WHERE value NOT LIKE 'permit:%' AND value NOT LIKE 'forbid:%'),
       '[]');
`,
};
