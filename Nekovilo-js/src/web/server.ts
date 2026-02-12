import express from 'express';
import session from 'express-session';
import { pool } from '../database/db';
import { ResponseHandler } from '../bot/ResponseHandler';
import { Client, ChannelType, PermissionsBitField } from 'discord.js';
import path from 'path';

// Extender tipos de sesión
declare module 'express-session' {
    interface SessionData {
        user: any;
        guilds: any[];
    }
}

export const startWebServer = (bot: Client, responseHandler: ResponseHandler) => {
    const app = express();
    const PORT = process.env.PORT || 3000;
    const ADMIN_ID = process.env.ADMIN_ID;

    app.set('view engine', 'ejs');
    // Ajustamos la ruta para que funcione tanto en 'src' como en 'dist'
    app.set('views', path.join(process.cwd(), 'views')); 
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(process.cwd(), 'public'))); // Por si añades CSS/Imágenes

    app.use(session({
        secret: process.env.SECRET_KEY || 'nekovilo_secret_key',
        resave: false,
        saveUninitialized: false,
        cookie: { 
            secure: false, // Pon TRUE si tu host tiene HTTPS (SSL)
            maxAge: 24 * 60 * 60 * 1000 // 24 horas
        } 
    }));

    // Middleware de Autenticación
    const isAuthenticated = (req: any, res: any, next: any) => {
        if (req.session.user) return next();
        res.redirect('/login');
    };

    // --- RUTAS PÚBLICAS ---

    app.get('/', (req, res) => {
        res.render('index', { authorized: !!req.session.user });
    });

    app.get('/login', (req, res) => {
        const redirect = encodeURIComponent(process.env.DISCORD_REDIRECT_URI!);
        // Scope necesario: identify y guilds (para ver permisos)
        const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${redirect}&response_type=code&scope=identify%20guilds`;
        res.redirect(url);
    });

    app.get('/logout', (req, res) => {
        req.session.destroy(() => res.redirect('/'));
    });

    // --- OAUTH2 CALLBACK (LA MAGIA) ---
    
    app.get('/callback', async (req, res) => {
        const code = req.query.code as string;
        if (!code) return res.redirect('/');

        try {
            // 1. Canjear el código por un Token de acceso
            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                body: new URLSearchParams({
                    client_id: process.env.DISCORD_CLIENT_ID!,
                    client_secret: process.env.DISCORD_CLIENT_SECRET!,
                    code,
                    grant_type: 'authorization_code',
                    redirect_uri: process.env.DISCORD_REDIRECT_URI!,
                }),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            });

            const tokenData = await tokenResponse.json();
            if (tokenData.error) throw new Error(tokenData.error_description);
            
            const accessToken = tokenData.access_token;

            // 2. Obtener datos del usuario
            const userFetch = await fetch('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const user = await userFetch.json();

            // 3. Obtener servidores del usuario
            const guildsFetch = await fetch('https://discord.com/api/users/@me/guilds', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const guilds = await guildsFetch.json();

            // Guardar en sesión
            req.session.user = user;
            req.session.guilds = guilds;

            res.redirect('/dashboard');
        } catch (e) {
            console.error("Error en Login:", e);
            res.redirect('/');
        }
    });

    // --- DASHBOARD ---

    app.get('/dashboard', isAuthenticated, (req, res) => {
        const userGuilds = req.session.guilds || [];
        
        // Filtramos: El usuario debe ser Admin (0x8) o tener ManageGuild (0x20)
        // Y el bot debe estar en ese servidor
        const validGuilds = userGuilds.filter((g: any) => {
            const botInGuild = bot.guilds.cache.has(g.id);
            const permissions = BigInt(g.permissions);
            const isAdmin = (permissions & BigInt(0x8)) === BigInt(0x8);
            const canManage = (permissions & BigInt(0x20)) === BigInt(0x20);
            
            return botInGuild && (isAdmin || canManage);
        }).map((g: any) => ({
            ...g,
            icon_url: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null
        }));

        res.render('dashboard', { 
            guilds: validGuilds, 
            user_id: req.session.user.id, 
            admin_id: ADMIN_ID 
        });
    });

    // --- GESTIÓN DE SERVIDOR ---

    app.get('/dashboard/:guildId', isAuthenticated, async (req, res) => {
        const guildId = req.params.guildId;
        
        // Verificación de seguridad extra: ¿El usuario tiene permiso en la sesión para este ID?
        const canEdit = req.session.guilds?.some((g:any) => g.id === guildId);
        if (!canEdit && req.session.user.id !== ADMIN_ID) return res.redirect('/dashboard');

        const guild = bot.guilds.cache.get(guildId);
        if (!guild) return res.redirect('/dashboard');

        // Obtener triggers de la DB
        const dbRes = await pool.query("SELECT * FROM rules WHERE guild_id = $1 ORDER BY id DESC", [guildId]);
        
        // Mapear canales de texto
        const channels = guild.channels.cache
            .filter(c => c.type === ChannelType.GuildText)
            .map(c => ({ id: c.id, name: c.name }));
            
        const channelMap = Object.fromEntries(channels.map(c => [c.id, c.name]));

        res.render('manage', {
            guild_id: guildId,
            guild_name: guild.name,
            triggers: dbRes.rows,
            channels: channels,
            channel_map: channelMap
        });
    });

    app.post('/dashboard/:guildId/add', isAuthenticated, async (req, res) => {
        const { guildId } = req.params;
        const { keyword, response, exceptions } = req.body;
        
        // Manejo de canales múltiples
        let channel_ids = req.body.channel_ids;
        if (!channel_ids) channel_ids = [];
        if (!Array.isArray(channel_ids)) channel_ids = [channel_ids];

        const exceptionsList = exceptions 
            ? exceptions.split(',').map((e: string) => e.trim()).filter((e: string) => e) 
            : [];

        if (channel_ids.length > 0 && keyword && response) {
            await responseHandler.addRule(guildId, channel_ids, [keyword], response, exceptionsList);
        }
        res.redirect(`/dashboard/${guildId}`);
    });

    app.get('/dashboard/:guildId/delete/:triggerId', isAuthenticated, async (req, res) => {
        const { guildId, triggerId } = req.params;
        // Seguridad básica
        const canEdit = req.session.guilds?.some((g:any) => g.id === guildId);
        if (canEdit || req.session.user.id === ADMIN_ID) {
            await responseHandler.removeRule(parseInt(triggerId), guildId);
        }
        res.redirect(`/dashboard/${guildId}`);
    });

    // --- ADMIN ---
    app.get('/admin', isAuthenticated, (req, res) => {
        if (req.session.user.id !== ADMIN_ID) return res.status(403).send("Acceso Denegado");
        
        // Estadísticas simples
        const guildList = bot.guilds.cache.map(g => ({
            id: g.id, name: g.name, members: g.memberCount, 
            icon: g.iconURL()
        }));

        res.render('admin', {
            user: req.session.user,
            guilds: guildList,
            total_stats: responseHandler.totalResponses,
            total_guilds: bot.guilds.cache.size
        });
    });

    app.listen(PORT, () => {
        console.log(`🌐 Dashboard online en puerto ${PORT}`);
    });
};