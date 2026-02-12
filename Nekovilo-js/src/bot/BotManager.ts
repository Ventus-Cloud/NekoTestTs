import { Client, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction, PermissionsBitField } from 'discord.js';
import { ResponseHandler } from './ResponseHandler';

export class BotManager {
    private client: Client;
    private responseHandler: ResponseHandler;

    constructor(client: Client, responseHandler: ResponseHandler) {
        this.client = client;
        this.responseHandler = responseHandler;
    }

    async registerCommands() {
        const commands = [
            new SlashCommandBuilder().setName('ping').setDescription('Comprueba la latencia'),
            new SlashCommandBuilder().setName('status').setDescription('Estado del bot'),
            new SlashCommandBuilder().setName('help').setDescription('Ayuda del bot'),
            new SlashCommandBuilder()
                .setName('addtrigger')
                .setDescription('Añadir trigger rápido (Canal actual)')
                .addStringOption(opt => opt.setName('keyword').setDescription('Palabra clave').setRequired(true))
                .addStringOption(opt => opt.setName('response').setDescription('Respuesta').setRequired(true))
                .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        ];

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

        try {
            console.log('Registrando Slash Commands...');
            // Registra comandos globales (puede tardar hasta 1 hora en actualizarse en Discord)
            // Para desarrollo, usa Routes.applicationGuildCommands(clientId, guildId)
            await rest.put(
                Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!),
                { body: commands }
            );
            console.log('✅ Comandos registrados.');
        } catch (error) {
            console.error(error);
        }
    }

    async handleInteraction(interaction: ChatInputCommandInteraction) {
        if (!interaction.isChatInputCommand()) return;

        const { commandName } = interaction;

        if (commandName === 'ping') {
            await interaction.reply(`Pong! 🏓 ${Math.round(this.client.ws.ping)}ms`);
        } 
        else if (commandName === 'status') {
            const embed = new EmbedBuilder()
                .setTitle("Bot Status")
                .setColor(0x00FF00) // Green
                .addFields(
                    { name: "Guilds", value: `${this.client.guilds.cache.size}`, inline: true },
                    { name: "Triggers", value: `${this.responseHandler.triggers.length}`, inline: true },
                    { name: "Responses Sent", value: `${this.responseHandler.totalResponses}`, inline: true }
                );
            await interaction.reply({ embeds: [embed] });
        }
        else if (commandName === 'addtrigger') {
            const keyword = interaction.options.getString('keyword', true);
            const response = interaction.options.getString('response', true);
            
            await interaction.deferReply();
            
            try {
                await this.responseHandler.addRule(
                    interaction.guildId!,
                    [interaction.channelId], // Lista con el canal actual
                    [keyword],
                    response
                );
                await interaction.editReply(`✅ Added trigger \`${keyword}\` -> \`${response}\` (En este canal)`);
            } catch (e) {
                console.error(e);
                await interaction.editReply("❌ Error añadiendo trigger.");
            }
        }
        else if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle("Ayuda de Nekovilo")
                .setColor(0x9B59B6)
                .setDescription("¡Respondo automáticamente a palabras clave! Usa la dashboard web para configurar.")
                .addFields({ name: "Web", value: `${process.env.DISCORD_REDIRECT_URI?.split('/callback')[0]}` });
            await interaction.reply({ embeds: [embed] });
        }
    }
}