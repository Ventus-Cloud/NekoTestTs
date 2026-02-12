import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Pool de conexiones (mejor que crear una conexión cada vez)
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Necesario para algunos hostings como Neon/Render
});

export const initDb = async () => {
    const client = await pool.connect();
    try {
        // Crear tabla si no existe
        await client.query(`
            CREATE TABLE IF NOT EXISTS rules (
                id SERIAL PRIMARY KEY,
                guild_id BIGINT NOT NULL,
                channel_ids BIGINT[] NOT NULL DEFAULT '{}',
                keywords TEXT[] NOT NULL,
                response TEXT NOT NULL,
                exceptions TEXT[] DEFAULT '{}',
                enabled BOOLEAN DEFAULT TRUE
            );
        `);
        console.log("✅ Tabla 'rules' verificada.");

        // Migración de channel_id (singular) a channel_ids (array) si fuera necesaria
        const res = await client.query(`
            SELECT data_type FROM information_schema.columns 
            WHERE table_name = 'rules' AND column_name = 'channel_id';
        `);
        
        if (res.rows.length > 0) {
            console.log("⚠️ Migrando esquema antiguo...");
            await client.query(`
                ALTER TABLE rules 
                ALTER COLUMN channel_id TYPE BIGINT[] USING ARRAY[channel_id];
                ALTER TABLE rules RENAME COLUMN channel_id TO channel_ids;
            `);
            console.log("✅ Migración completada.");
        }

    } catch (err) {
        console.error("❌ Error DB Init:", err);
    } finally {
        client.release();
    }
};