/**
 * Run a SQL file against the app database.
 * Usage: node scripts/run-sql.js sql/002_search_function.sql
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/run-sql.js <sql-file>");
    process.exit(1);
  }
  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }
  const sql = fs.readFileSync(filePath, "utf8");

  const pool = new Pool({
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432", 10),
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE || "test",
  });

  try {
    await pool.query(sql);
    console.log("OK:", file);
  } catch (e) {
    console.error("Error running", file, e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
