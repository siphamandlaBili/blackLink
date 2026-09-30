// Local MongoDB without installing anything: starts an in-memory single-node replica set
// (replica set, so transactions work) and prints its URI. Data is lost when you stop it.
//   npm run db:memory      then put the printed URI in MONGODB_URI
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const PORT = Number(process.env.MEMORY_DB_PORT ?? 27027);
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ port: PORT }] });
const uri = replSet.getUri();

process.stdout.write(`\nIn-memory MongoDB replica set running.\nMONGODB_URI=${uri}\nPress Ctrl+C to stop.\n\n`);

const stop = async () => {
  await replSet.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
