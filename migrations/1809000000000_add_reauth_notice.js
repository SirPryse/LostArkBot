export const shorthands = undefined;

/**
 * The message id of each guild's "lostark.bible re-link needed" post in its
 * announcement channel (see src/notify/reauthNotice.js). Stored so the post
 * can be edited in place as people expire/re-link instead of posting a new
 * one every time, and deleted once nobody needs to re-link. Null = no
 * notice currently posted (or it was wiped by the weekly channel clear).
 */
export async function up(pgm) {
  pgm.addColumns('guild_settings', {
    reauth_notice_message_id: { type: 'text' },
  });
}

export async function down(pgm) {
  pgm.dropColumns('guild_settings', ['reauth_notice_message_id']);
}
