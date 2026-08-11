import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { randomBytes } from 'node:crypto';
import { buildAuthorizeUrl, generateCodeVerifier } from '../../lostarkbible/oauth.js';
import { storePendingLink } from '../../oauth/pendingLinks.js';

export const linkAccountCommand = {
  data: new SlashCommandBuilder()
    .setName('link-account')
    .setDescription('Connect your lostark.bible account so you can track characters'),

  async execute(interaction) {
    const state = randomBytes(16).toString('base64url');
    const codeVerifier = generateCodeVerifier();
    storePendingLink(state, { discordUserId: interaction.user.id, codeVerifier });

    const authorizeUrl = buildAuthorizeUrl({ state, codeVerifier });

    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Authorize on lostark.bible').setStyle(ButtonStyle.Link).setURL(authorizeUrl),
    );

    await interaction.reply({
      content: "Click below to connect your lostark.bible account. Once you approve it, come back and run `/track-character`.",
      components: [button],
      flags: MessageFlags.Ephemeral,
    });
  },
};
