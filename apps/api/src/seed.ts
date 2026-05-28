import { databaseType, getDatabase } from "./db.js";

await getDatabase();
console.log(`${databaseType()} database is ready.`);
