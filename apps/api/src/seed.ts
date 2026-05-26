import { getDatabase } from "./db.js";

await getDatabase();
console.log("SQLite database is ready.");
