export const shorthands = undefined;

export async function up(pgm) {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable('linked_accounts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    discord_user_id: { type: 'text', notNull: true, unique: true },
    lostarkbible_user_id: { type: 'text', notNull: true },
    access_token: { type: 'text', notNull: true },
    token_expires_at: { type: 'timestamptz', notNull: true },
    scopes: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'active' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('linked_accounts', 'linked_accounts_status_check', {
    check: "status in ('active', 'needs_reauth', 'revoked')",
  });

  pgm.createTable('tracked_characters', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    linked_account_id: {
      type: 'uuid',
      notNull: true,
      references: 'linked_accounts',
      onDelete: 'cascade',
    },
    character_name: { type: 'text', notNull: true },
    region: { type: 'text', notNull: true },
    guild_id: { type: 'text', notNull: true },
    enabled: { type: 'boolean', notNull: true, default: true },
    last_seen_log_id: { type: 'text' },
    last_checked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('tracked_characters', 'tracked_characters_region_check', {
    check: "region in ('CE', 'NA')",
  });

  pgm.addConstraint('tracked_characters', 'tracked_characters_unique', {
    unique: ['linked_account_id', 'character_name', 'region', 'guild_id'],
  });

  pgm.createTable('guild_settings', {
    guild_id: { type: 'text', primaryKey: true },
    announcement_channel_id: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
}

export async function down(pgm) {
  pgm.dropTable('tracked_characters');
  pgm.dropTable('guild_settings');
  pgm.dropTable('linked_accounts');
}
