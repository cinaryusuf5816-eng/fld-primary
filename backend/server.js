const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();
app.use(cors());

const pool = new Pool({
    user: "berkecanyildiz",
    host: "localhost",
    database: "fld_primary",
    port: 5432
});

app.get("/api/events", async function (req, res) {

    try {
        const result = await pool.query(`
            SELECT
                id,
                created_at,
                title,
                TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
                start_time,
                end_time,
                category,
                description,
                days
            FROM events
            ORDER BY start_date, start_time
        `);

        res.json(result.rows);

    } catch (error) {
        console.error("Database error:", error);

        res.status(500).json({
            error: "Could not load events."
        });
    }

});

app.listen(3000, function() {
    console.log("FLD Backend is running on port 3000.");
});