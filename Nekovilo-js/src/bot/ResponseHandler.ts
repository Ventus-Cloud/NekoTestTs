import { pool } from '../database/db';

interface Trigger {
    id?: number;
    keywords: string[];
    response: string;
    channel_ids: string[]; // JS trata BIGINT como string a veces para no perder precisión
    exceptions: string[];
}

export class ResponseHandler {
    public triggers: Trigger[] = [];
    public totalResponses: number = 0;

    async loadTriggers() {
        try {
            const res = await pool.query("SELECT * FROM rules WHERE enabled = TRUE");
            this.triggers = res.rows.map(row => ({
                keywords: row.keywords.map((k: string) => k.toLowerCase()),
                response: row.response,
                channel_ids: row.channel_ids || [],
                exceptions: (row.exceptions || []).map((e: string) => e.toLowerCase())
            }));
            console.log(`🔄 ${this.triggers.length} triggers cargados en memoria.`);
        } catch (err) {
            console.error("Error cargando triggers:", err);
        }
    }

    checkTriggers(content: string, channelId: string): string | null {
        if (!content) return null;
        const contentLower = content.toLowerCase();

        for (const trigger of this.triggers) {
            // Verificar canal
            if (!trigger.channel_ids.includes(channelId)) continue;

            // Verificar palabra clave
            const matchesKeyword = trigger.keywords.some(k => contentLower.includes(k));
            if (!matchesKeyword) continue;

            // Verificar excepciones
            const matchesException = trigger.exceptions.some(e => contentLower.includes(e));
            if (matchesException) continue;

            this.totalResponses++;
            return trigger.response;
        }
        return null;
    }

    async addRule(guildId: string, channelIds: string[], keywords: string[], response: string, exceptions: string[] = []) {
        await pool.query(
            `INSERT INTO rules (guild_id, channel_ids, keywords, response, exceptions, enabled)
             VALUES ($1, $2, $3, $4, $5, TRUE)`,
            [guildId, channelIds, keywords, response, exceptions]
        );
        await this.loadTriggers();
    }

    async removeRule(triggerId: number, guildId: string) {
        await pool.query("DELETE FROM rules WHERE id = $1 AND guild_id = $2", [triggerId, guildId]);
        await this.loadTriggers();
    }
    
    async removeAllGuildRules(guildId: string) {
        await pool.query("DELETE FROM rules WHERE guild_id = $1", [guildId]);
        await this.loadTriggers();
    }
}