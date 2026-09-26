import type { Migration } from "../db.js";
import { init } from "./001_init.js";
import { search } from "./002_search.js";
import { claimVisuals } from "./003_claim_visuals.js";

/** Ordered, immutable migration list. Never edit an applied migration. */
export const MIGRATIONS: Migration[] = [init, search, claimVisuals];
