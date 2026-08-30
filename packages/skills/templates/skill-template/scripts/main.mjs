#!/usr/bin/env node
/**
 * Optional helper script scaffold for a Tau skill.
 * Tau never runs these automatically — call them from declarative commands
 * or from your own shell steps if you really need to.
 *
 * Usage: node scripts/main.mjs <anything>
 */
const arg = process.argv[2] ?? "(no argument)";
console.log(`[skill-template] received: ${arg}`);
console.log("Replace this file with your own helpers.");
