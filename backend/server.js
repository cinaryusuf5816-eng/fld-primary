const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT)
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

app.post("/api/events", async function (req, res) {

    try {
        const {
            title,
            startDate,
            endDate,
            startTime,
            endTime,
            category,
            description,
            days
        } = req.body;

        const result = await pool.query(
            `
            INSERT INTO events (
            title,
            start_date,
            end_date,
            start_time,
            end_time,
            category,
            description,
            days
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            `,

            [
                title,
                startDate,
                endDate,
                startTime || null,
                endTime || null,
                category,
                description,
                days
            ]
        );
    
        res.status(201).json(result.rows[0]);
        
    } catch (error) {
        console.error("Database error:", error);

        res.status(500).json({
            error: "Could not create event."
        });
    }

});

app.listen(3000, function() {
    console.log("FLD Backend is running on port 3000.");
});