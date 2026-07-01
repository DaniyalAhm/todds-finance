'use server';

import * as api from '@actual-app/api';

export async function testActualConnection() {
  const serverURL = process.env.ACTUAL_SERVER_URL;
  const password = process.env.ACTUAL_PASSWORD;
  const syncId = process.env.ACTUAL_SYNC_ID;

  if (!serverURL || !password || !syncId) {
    throw new Error("Missing ACTUAL_SERVER_URL, ACTUAL_PASSWORD, or ACTUAL_SYNC_ID env vars");
  }

  await api.init({
    dataDir: './cache/',
    serverURL,
    password,
  });

  await api.downloadBudget(syncId);

  const budget = await api.getBudgetMonth('2019-10');
  await api.shutdown();

  return budget;
}