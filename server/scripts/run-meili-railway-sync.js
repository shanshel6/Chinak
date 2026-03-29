import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { setTimeout as sleep } from 'timers/promises';

const DEFAULT_JWT_SECRET = 'c2hhbnNoYWw2Ni1teS1zaG9wLWJhY2tlbmQtc2VjcmV0LTIwMjY=';

function getEnvNumber(name, fallback, minimum = Number.NEGATIVE_INFINITY) {
  const raw = process.env[name];
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < minimum) return fallback;
  return parsed;
}

function getEnvBoolean(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'y';
}

function trimTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

function toErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isFatalReindexError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('no space left on device')
    || normalized.includes('os error 28')
    || normalized.includes('disk full')
    || normalized.includes('enospc');
}

function getFatalReindexHint(message) {
  if (!isFatalReindexError(message)) return null;
  return 'Railway Meilisearch storage is full. Free or expand the Meilisearch volume, then run the sync again.';
}

function formatJson(value) {
  return JSON.stringify(value ?? null);
}

function parseIsoDate(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function formatMinutes(totalMs) {
  const minutes = totalMs / 60000;
  return minutes >= 10 ? minutes.toFixed(0) : minutes.toFixed(1);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return null;
  return new Intl.NumberFormat('en-US').format(value);
}

function buildStatusSummary(status, elapsedMs) {
  const parts = [];
  const elapsedText = elapsedMs != null ? `${formatMinutes(elapsedMs)}m` : null;
  if (elapsedText) parts.push(`elapsed=${elapsedText}`);
  if (status?.phase) parts.push(`phase=${status.phase}`);
  if (Number.isFinite(status?.progressPercent)) parts.push(`progress=${status.progressPercent}%`);
  if (Number.isFinite(status?.totalIndexed)) parts.push(`indexed=${formatNumber(status.totalIndexed)}`);
  if (Number.isFinite(status?.totalProducts) && status.totalProducts > 0) parts.push(`total=${formatNumber(status.totalProducts)}`);
  if (Number.isFinite(status?.processedBatches) && status.processedBatches > 0) parts.push(`batches=${formatNumber(status.processedBatches)}`);
  if (Number.isFinite(status?.currentBatchNumber) && status.currentBatchNumber > 0) parts.push(`currentBatch=${formatNumber(status.currentBatchNumber)}`);
  if (Number.isFinite(status?.currentBatchSize) && status.currentBatchSize > 0) parts.push(`batchSize=${formatNumber(status.currentBatchSize)}`);
  if (Number.isFinite(status?.lastIndexedId) && status.lastIndexedId > 0) parts.push(`lastIndexedId=${formatNumber(status.lastIndexedId)}`);
  if (status?.currentTaskUid != null && status.currentTaskUid !== '') parts.push(`taskUid=${status.currentTaskUid}`);
  return parts.join(', ');
}

function getLatestDebugEntry(status) {
  if (!Array.isArray(status?.debugLog) || status.debugLog.length === 0) return null;
  const lastEntry = status.debugLog[status.debugLog.length - 1];
  if (!lastEntry || typeof lastEntry !== 'object') return null;
  return lastEntry;
}

function formatDebugEntry(entry) {
  if (!entry) return null;
  const parts = [entry.at, entry.message].filter(Boolean);
  if (entry.data && typeof entry.data === 'object') {
    parts.push(formatJson(entry.data));
  }
  return parts.join(' | ');
}

function buildAdminToken() {
  const secret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
  const rawId = process.env.ADMIN_USER_ID || '72';
  const parsedId = Number.parseInt(rawId, 10);
  const adminUser = {
    id: Number.isFinite(parsedId) ? parsedId : rawId,
    role: process.env.ADMIN_USER_ROLE || 'ADMIN',
    email: process.env.ADMIN_USER_EMAIL || 'shanshel6@gmail.com'
  };

  return jwt.sign(adminUser, secret, { expiresIn: '36500d' });
}

async function requestJson(method, url, token, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const text = await response.text();
    let payload = null;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${typeof payload === 'string' ? payload : formatJson(payload)}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function getFailureFromStatus(status) {
  if (!status || typeof status !== 'object') return 'Missing reindex status response';
  if (status.lastError) return status.lastError;
  return null;
}

const config = {
  appUrl: trimTrailingSlashes(process.env.APP_URL || 'https://chinak-production.up.railway.app'),
  pollSeconds: getEnvNumber('MEILI_REINDEX_POLL_SECONDS', 10, 1),
  retryDelaySeconds: getEnvNumber('MEILI_REINDEX_RETRY_DELAY_SECONDS', 15, 1),
  maxAttempts: getEnvNumber('MEILI_REINDEX_MAX_ATTEMPTS', 0, 0),
  reset: getEnvBoolean('MEILI_REINDEX_RESET', true),
  requestTimeoutMs: getEnvNumber('MEILI_REINDEX_REQUEST_TIMEOUT_MS', 30000, 1000),
  maxRunningMinutes: getEnvNumber('MEILI_REINDEX_MAX_RUNNING_MINUTES', 45, 1)
};

async function getStatus(token) {
  return requestJson('GET', `${config.appUrl}/api/admin/search/reindex-status`, token);
}

async function triggerReindex(token) {
  const url = `${config.appUrl}/api/admin/search/reindex${config.reset ? '?reset=1' : ''}`;
  return requestJson('POST', url, token);
}

function buildRunningTooLongError(status, startedAtMs, attachedToExistingJob) {
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const source = attachedToExistingJob ? 'existing Railway reindex job' : 'Railway reindex job';
  return new Error(`${source} has been running for ${formatMinutes(elapsedMs)} minutes, which exceeds the MEILI_REINDEX_MAX_RUNNING_MINUTES=${config.maxRunningMinutes} limit. Last status: ${formatJson(status)}`);
}

async function waitForCompletion(token, initialStatus = null, attachedToExistingJob = false) {
  const remoteStartedAtMs = parseIsoDate(initialStatus?.lastStartedAt);
  const monitorStartedAtMs = Date.now();
  let lastDebugMarker = '';

  if (remoteStartedAtMs && Date.now() - remoteStartedAtMs > config.maxRunningMinutes * 60000) {
    throw buildRunningTooLongError(initialStatus, remoteStartedAtMs, attachedToExistingJob);
  }

  while (true) {
    await sleep(config.pollSeconds * 1000);
    const status = await getStatus(token);
    const statusStartedAtMs = parseIsoDate(status?.lastStartedAt) ?? remoteStartedAtMs;
    const elapsedMs = statusStartedAtMs ? Math.max(0, Date.now() - statusStartedAtMs) : Math.max(0, Date.now() - monitorStartedAtMs);
    const summary = buildStatusSummary(status, elapsedMs);
    console.log(summary ? `Status: ${summary}` : `Status after ${formatMinutes(elapsedMs)} minutes: ${formatJson(status)}`);
    const latestDebugEntry = getLatestDebugEntry(status);
    const debugMarker = latestDebugEntry ? `${latestDebugEntry.at}|${latestDebugEntry.message}` : '';
    if (debugMarker && debugMarker !== lastDebugMarker) {
      lastDebugMarker = debugMarker;
      console.log(`Latest debug: ${formatDebugEntry(latestDebugEntry)}`);
    }

    if (!status?.running) {
      const failure = getFailureFromStatus(status);
      if (failure) throw new Error(`Reindex failed: ${failure}`);
      return status;
    }

    if (statusStartedAtMs && Date.now() - statusStartedAtMs > config.maxRunningMinutes * 60000) {
      throw buildRunningTooLongError(status, statusStartedAtMs, attachedToExistingJob);
    }
  }
}

async function runAttempt(attemptNumber) {
  const token = buildAdminToken();
  console.log('');
  console.log(`Starting Meili reindex attempt ${attemptNumber} against ${config.appUrl}...`);
  console.log('Triggering reindex...');

  const triggerResponse = await triggerReindex(token);
  console.log(`Trigger response: ${formatJson(triggerResponse)}`);
  const initialSummary = buildStatusSummary(triggerResponse, parseIsoDate(triggerResponse?.lastStartedAt) ? Math.max(0, Date.now() - parseIsoDate(triggerResponse.lastStartedAt)) : null);
  if (initialSummary) {
    console.log(`Current progress: ${initialSummary}`);
  }
  const initialDebug = getLatestDebugEntry(triggerResponse);
  if (initialDebug) {
    console.log(`Latest debug: ${formatDebugEntry(initialDebug)}`);
  }

  const attachedToExistingJob = triggerResponse?.started === false && triggerResponse?.running;
  if (triggerResponse?.started === false && triggerResponse?.running) {
    console.log('A reindex job is already running. Monitoring the existing job.');
  }

  const finalStatus = await waitForCompletion(token, triggerResponse, attachedToExistingJob);
  const indexedCount = finalStatus?.lastResult?.totalIndexed;

  if (Number.isFinite(indexedCount)) {
    console.log(`Indexed documents: ${indexedCount}`);
  }

  console.log('Reindex finished successfully.');
}

async function main() {
  let attemptNumber = 0;

  while (true) {
    attemptNumber += 1;

    try {
      await runAttempt(attemptNumber);
      return;
    } catch (error) {
      const message = toErrorMessage(error);
      console.log('');
      console.log(`Meili reindex attempt ${attemptNumber} failed: ${message}`);
      const fatalHint = getFatalReindexHint(message);
      if (fatalHint) {
        console.log(fatalHint);
        process.exitCode = 1;
        return;
      }

      if (config.maxAttempts !== 0 && attemptNumber >= config.maxAttempts) {
        process.exitCode = 1;
        return;
      }

      console.log(`Waiting ${config.retryDelaySeconds}s before retrying...`);
      await sleep(config.retryDelaySeconds * 1000);
    }
  }
}

await main();
