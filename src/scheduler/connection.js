import IORedis from 'ioredis';
import { config } from '../config.js';

// BullMQ requires this for its blocking commands.
export const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
