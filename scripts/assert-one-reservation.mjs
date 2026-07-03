// Asserts exactly one reservation exists — the post-load-test invariant proving
// only one caller won the contended slot.
import "dotenv/config";
import pg from "pg";

const client = new pg.Client(process.env.DATABASE_URL.split("?")[0]);
await client.connect();
const { rows } = await client.query('SELECT count(*)::int AS n FROM "Reservation"');
await client.end();
const n = rows[0].n;
if (n !== 1) {
  console.error(`FAIL: expected exactly 1 reservation, found ${n}`);
  process.exit(1);
}
console.log("OK: exactly one reservation won under HTTP load");
