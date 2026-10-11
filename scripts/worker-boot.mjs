// Lets worker_threads run TypeScript entry points through tsx.
import { register } from 'tsx/esm/api';
import { workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

register();
await import(pathToFileURL(workerData.__entry).href);
