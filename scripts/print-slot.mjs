// Prints the id of one Available slot — used by the load-test job to target the
// concurrency test at a real, contended row.
import "dotenv/config";
import pg from "pg";

const client = new pg.Client(process.env.DATABASE_URL.split("?")[0]);
await client.connect();
const { rows } = await client.query(
  `SELECT id FROM "AppointmentSlot" WHERE status = 'Available' ORDER BY "startsAt" LIMIT 1`
);
await client.end();
if (!rows[0]) {
  console.error("no available slot — run the seed first");
  process.exit(1);
}
process.stdout.write(rows[0].id);
