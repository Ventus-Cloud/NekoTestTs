import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';
import { initDb } from './database/db';
import { ResponseHandler } from './bot/ResponseHandler';
import { BotManager } from './bot/BotManager';
import { startWebServer } from './web/server';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

const responseHandler = new ResponseHandler();
const botManager = new BotManager(client, responseHandler);

client.once('ready', async () => {
    console.log(`🔥 Bot conectado como ${client.user?.tag}`);
    
    // Inicializar DB y Cargar Triggers
    await initDb();
    await responseHandler.loadTriggers();
    
    // Registrar Comandos Slash
    await botManager.registerCommands();
    
    // Iniciar Web Server
    startWebServer(client, responseHandler);

    // Loop de recarga (Cada 5 min)
    setInterval(() => responseHandler.loadTriggers(), 5 * 60 * 1000);
});

client.on('interactionCreate', (interaction) => {
    // @ts-ignore
    botManager.handleInteraction(interaction);
});

client.on('messageCreate', (message) => {
    if (message.author.bot) return;

    const response = responseHandler.checkTriggers(message.content, message.channelId);
    if (response) {
        message.channel.send(response).catch(console.error);
    }
});

client.login(process.env.DISCORD_TOKEN);