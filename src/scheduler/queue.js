import { Queue } from 'bullmq';
import { connection } from './connection.js';
import { config } from '../config.js';

export const raidPollQueue = new Queue('raid-poll', { connection });

const TICK_JOB_OPTS = { removeOnComplete: true, removeOnFail: true };

export async function startTickScheduler() {
  await raidPollQueue.upsertJobScheduler(
    'raid-poll-tick',
    { every: config.pollIntervalMinutes * 60 * 1000 },
    { name: 'tick', data: {}, opts: TICK_JOB_OPTS },
  );
}

/** Used by the /check-now debug command to trigger an out-of-band poll. */
export async function enqueueImmediateTick() {
  await raidPollQueue.add('tick', {}, TICK_JOB_OPTS);
}
