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

function getOptionalEnvNumber(name, minimum = Number.NEGATIVE_INFINITY) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return null;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < minimum) return null;
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

function parseBatchSizeSequence(rawValue) {
  const source = String(rawValue || '').trim();
  const parts = source
    ? source.split(',').map((part) => Number.parseInt(String(part).trim(), 10))
    : [200, 100, 50, 25];
  const sanitized = Array.from(new Set(parts.filter((value) => Number.isFinite(value) && value >= 10)))
    .sort((a, b) => b - a);
  return sanitized.length > 0 ? sanitized : [200, 100, 50, 25];
}

function getNextLowerBatchSize(currentBatchSize, sequence) {
  const current = Number.isFinite(currentBatchSize) ? currentBatchSize : 0;
  const seq = Array.isArray(sequence) && sequence.length > 0 ? sequence : [200, 100, 50, 25];
  for (const candidate of seq) {
    if (candidate < current) return candidate;
  }
  return null;
}

function isMeiliTaskStallError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('appears stalled')
    || normalized.includes('"phase":"waiting_for_meili_task"')
    || normalized.includes('while status=processing')
    || normalized.includes('exceeded max wait');
}

function isTransientNetworkError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('etimedout')
    || normalized.includes('econnreset')
    || normalized.includes('the operation was aborted')
    || normalized.includes('fetch failed')
    || normalized.includes('eai_again')
    || normalized.includes('socket hang up')
    || normalized.includes('network timeout')
    || normalized.includes('request to')
    || normalized.includes('aborted');
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

function buildProgressMarker(status) {
  return [
    status?.phase || '',
    Number.isFinite(status?.totalIndexed) ? status.totalIndexed : '',
    Number.isFinite(status?.lastIndexedId) ? status.lastIndexedId : '',
    status?.currentTaskUid ?? ''
  ].join('|');
}

function buildStalledProgressError(status, stalledForMs) {
  return new Error(
    `Railway reindex job appears stalled for ${formatMinutes(stalledForMs)} minutes on task ${status?.currentTaskUid ?? 'unknown'}. `
    + `Last status: ${formatJson(status)}. Restart/redeploy the Railway backend so the persisted reindex state can resume from the last saved batch.`
  );
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
  if (Number.isFinite(status?.configuredBatchSize) && status.configuredBatchSize > 0) parts.push(`configuredBatchSize=${formatNumber(status.configuredBatchSize)}`);
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

function buildResumeCheckpoint(status) {
  const lastIndexedId = Number(status?.lastIndexedId);
  const totalIndexed = Number(status?.totalIndexed);
  const processedBatches = Number(status?.processedBatches);
  if (!Number.isFinite(lastIndexedId) || lastIndexedId <= 0) return null;
  return {
    lastIndexedId,
    totalIndexed: Number.isFinite(totalIndexed) && totalIndexed >= 0 ? totalIndexed : 0,
    processedBatches: Number.isFinite(processedBatches) && processedBatches >= 0 ? processedBatches : 0
  };
}

function isBetterResumeCheckpoint(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  if (candidate.totalIndexed !== current.totalIndexed) return candidate.totalIndexed > current.totalIndexed;
  return candidate.lastIndexedId > current.lastIndexedId;
}

let rememberedResumeCheckpoint = null;

function rememberResumeCheckpoint(status) {
  const checkpoint = buildResumeCheckpoint(status);
  if (isBetterResumeCheckpoint(checkpoint, rememberedResumeCheckpoint)) {
    rememberedResumeCheckpoint = checkpoint;
  }
}

function getConfiguredResumeCheckpoint() {
  const lastIndexedId = getOptionalEnvNumber('MEILI_REINDEX_RESUME_FROM_ID', 1);
  if (!lastIndexedId) return null;
  const totalIndexed = getOptionalEnvNumber('MEILI_REINDEX_RESUME_INDEXED', 0);
  const processedBatches = getOptionalEnvNumber('MEILI_REINDEX_RESUME_PROCESSED_BATCHES', 0);
  return {
    lastIndexedId,
    totalIndexed: totalIndexed ?? lastIndexedId,
    processedBatches: processedBatches ?? 0
  };
}

function getPreferredResumeCheckpoint() {
  const configuredResumeCheckpoint = getConfiguredResumeCheckpoint();
  if (isBetterResumeCheckpoint(configuredResumeCheckpoint, rememberedResumeCheckpoint)) {
    return configuredResumeCheckpoint;
  }
  return rememberedResumeCheckpoint;
}

function buildResumeRequestPayload(shouldReset, resumeCheckpoint = null) {
  const payload = {};
  if (shouldReset) {
    payload.reset = true;
  }
  if (resumeCheckpoint?.lastIndexedId > 0) {
    payload.resumeFromId = resumeCheckpoint.lastIndexedId;
    payload.resumeIndexed = resumeCheckpoint.totalIndexed || 0;
    payload.resumeProcessedBatches = resumeCheckpoint.processedBatches || 0;
  }
  if (Number.isFinite(config.batchSize) && config.batchSize > 0) {
    payload.batchSize = config.batchSize;
  }
  return payload;
}

function shouldValidateResumeCheckpoint(status) {
  const phase = String(status?.phase || '');
  return Boolean(Number.isFinite(status?.totalProducts) && status.totalProducts > 0)
    || phase === 'loading_batch'
    || phase === 'preparing_batch'
    || phase === 'uploading_batch'
    || phase === 'waiting_for_meili_task'
    || phase === 'batch_completed'
    || phase === 'batch_skipped'
    || phase === 'finalizing'
    || phase === 'completed'
    || phase === 'failed';
}

function didStatusHonorResumeCheckpoint(status, resumeCheckpoint) {
  if (!resumeCheckpoint?.lastIndexedId || !shouldValidateResumeCheckpoint(status)) {
    return true;
  }
  const indexedTolerance = Math.max(200, Math.floor((resumeCheckpoint.totalIndexed || 0) * 0.01));
  const currentLastIndexedId = Math.max(0, Number(status?.lastIndexedId) || 0);
  const currentTotalIndexed = Math.max(0, Number(status?.totalIndexed) || 0);
  return currentLastIndexedId >= resumeCheckpoint.lastIndexedId || currentTotalIndexed + indexedTolerance >= (resumeCheckpoint.totalIndexed || 0);
}

function buildResumeCheckpointIgnoredError(status, resumeCheckpoint) {
  return new Error(
    `Railway started reindexing before the requested checkpoint. `
    + `Requested resumeFromId=${resumeCheckpoint?.lastIndexedId ?? 0}, resumeIndexed=${resumeCheckpoint?.totalIndexed ?? 0}, `
    + `resumeProcessedBatches=${resumeCheckpoint?.processedBatches ?? 0}, `
    + `but current status is ${formatJson({
      phase: status?.phase ?? null,
      totalIndexed: status?.totalIndexed ?? null,
      lastIndexedId: status?.lastIndexedId ?? null,
      processedBatches: status?.processedBatches ?? null,
      totalProducts: status?.totalProducts ?? null
    })}. `
    + `This means the remote backend ignored the resume checkpoint or the checkpoint is incorrect.`
  );
}

function isResumeCheckpointIgnoredError(message) {
  return String(message || '').includes('Railway started reindexing before the requested checkpoint.');
}

function getResumeCheckpointIgnoredHint() {
  return 'The Railway backend handling /api/admin/search/reindex is not honoring resumeFromId yet. Deploy the updated backend code to Railway, then start the reindex again. The local batch file is already configured for the 76.9% checkpoint.';
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

function isReindexComplete(status) {
  if (!status || typeof status !== 'object') return false;
  if (typeof status.isComplete === 'boolean') return status.isComplete;
  const totalProducts = Math.max(0, Number(status.totalProducts) || 0);
  const totalIndexed = Math.max(0, Number(status.totalIndexed) || 0);
  if (totalProducts === 0) return true;
  return totalIndexed >= totalProducts;
}

function buildIncompleteCompletionError(status) {
  return new Error(
    `Reindex stopped before reaching 100%. Final status was ${formatJson({
      phase: status?.phase ?? null,
      totalIndexed: status?.totalIndexed ?? null,
      totalProducts: status?.totalProducts ?? null,
      progressPercent: status?.progressPercent ?? null,
      processedBatches: status?.processedBatches ?? null,
      lastIndexedId: status?.lastIndexedId ?? null
    })}.`
  );
}

const config = {
  appUrl: trimTrailingSlashes(process.env.APP_URL || 'https://chinak-production.up.railway.app'),
  batchSize: getEnvNumber('MEILI_REINDEX_BATCH_SIZE', 50, 10),
  pollSeconds: getEnvNumber('MEILI_REINDEX_POLL_SECONDS', 10, 1),
  statusHeartbeatSeconds: getEnvNumber('MEILI_REINDEX_STATUS_HEARTBEAT_SECONDS', 60, 5),
  retryDelaySeconds: getEnvNumber('MEILI_REINDEX_RETRY_DELAY_SECONDS', 15, 1),
  maxAttempts: getEnvNumber('MEILI_REINDEX_MAX_ATTEMPTS', 0, 0),
  reset: getEnvBoolean('MEILI_REINDEX_RESET', true),
  resetOnRetry: getEnvBoolean('MEILI_REINDEX_RESET_ON_RETRY', false),
  requestTimeoutMs: getEnvNumber('MEILI_REINDEX_REQUEST_TIMEOUT_MS', 30000, 1000),
  maxRunningMinutes: getEnvNumber('MEILI_REINDEX_MAX_RUNNING_MINUTES', 480, 1),
  maxConsecutiveStatusFailures: getEnvNumber('MEILI_REINDEX_MAX_CONSECUTIVE_STATUS_FAILURES', 12, 1),
  maxStalledMinutes: getEnvNumber('MEILI_REINDEX_MAX_STALLED_MINUTES', 45, 1)
};
const batchDownshiftSequence = parseBatchSizeSequence(process.env.MEILI_REINDEX_BATCH_DOWNSHIFT_SEQUENCE);

async function getStatus(token) {
  return requestJson('GET', `${config.appUrl}/api/admin/search/reindex-status`, token);
}

async function triggerReindex(token, shouldReset, resumeCheckpoint = null) {
  const payload = buildResumeRequestPayload(shouldReset, resumeCheckpoint);
  const params = new URLSearchParams();
  if (payload.reset) params.set('reset', '1');
  if (Number.isFinite(payload.resumeFromId) && payload.resumeFromId > 0) {
    params.set('resumeFromId', String(payload.resumeFromId));
    params.set('resumeIndexed', String(payload.resumeIndexed || 0));
    params.set('resumeProcessedBatches', String(payload.resumeProcessedBatches || 0));
  }
  if (Number.isFinite(payload.batchSize) && payload.batchSize > 0) {
    params.set('batchSize', String(payload.batchSize));
  }
  const query = params.toString();
  const url = `${config.appUrl}/api/admin/search/reindex${query ? `?${query}` : ''}`;
  return requestJson('POST', url, token, Object.keys(payload).length > 0 ? payload : undefined);
}

function buildRunningTooLongError(status, startedAtMs, attachedToExistingJob) {
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const source = attachedToExistingJob ? 'existing Railway reindex job' : 'Railway reindex job';
  return new Error(`${source} has been running for ${formatMinutes(elapsedMs)} minutes, which exceeds the MEILI_REINDEX_MAX_RUNNING_MINUTES=${config.maxRunningMinutes} limit. Last status: ${formatJson(status)}`);
}

async function waitForCompletion(token, initialStatus = null, attachedToExistingJob = false, expectedResumeCheckpoint = null) {
  const remoteStartedAtMs = parseIsoDate(initialStatus?.lastStartedAt);
  const monitorStartedAtMs = Date.now();
  let lastDebugMarker = '';
  let consecutiveStatusFailures = 0;
  let lastProgressMarker = buildProgressMarker(initialStatus);
  let lastProgressAtMs = Date.now();
  let lastPrintedStatusMarker = '';
  let lastStatusPrintAtMs = 0;

  if (remoteStartedAtMs && Date.now() - remoteStartedAtMs > config.maxRunningMinutes * 60000) {
    throw buildRunningTooLongError(initialStatus, remoteStartedAtMs, attachedToExistingJob);
  }

  while (true) {
    await sleep(config.pollSeconds * 1000);
    let status = null;
    try {
      status = await getStatus(token);
      consecutiveStatusFailures = 0;
    } catch (error) {
      const message = toErrorMessage(error);
      if (!isTransientNetworkError(message)) throw error;
      consecutiveStatusFailures += 1;
      console.log(`Status check failed (${consecutiveStatusFailures}/${config.maxConsecutiveStatusFailures}): ${message}`);
      if (consecutiveStatusFailures >= config.maxConsecutiveStatusFailures) {
        throw error;
      }
      continue;
    }
    const statusStartedAtMs = parseIsoDate(status?.lastStartedAt) ?? remoteStartedAtMs;
    const elapsedMs = statusStartedAtMs ? Math.max(0, Date.now() - statusStartedAtMs) : Math.max(0, Date.now() - monitorStartedAtMs);
    rememberResumeCheckpoint(status);
    const summary = buildStatusSummary(status, elapsedMs);
    const statusMarker = [
      buildProgressMarker(status),
      Number.isFinite(status?.totalProducts) ? status.totalProducts : '',
      Number.isFinite(status?.processedBatches) ? status.processedBatches : '',
      Number.isFinite(status?.currentBatchNumber) ? status.currentBatchNumber : '',
      Number.isFinite(status?.currentBatchSize) ? status.currentBatchSize : '',
      Number.isFinite(status?.configuredBatchSize) ? status.configuredBatchSize : ''
    ].join('|');
    const now = Date.now();
    const shouldPrintStatus = statusMarker !== lastPrintedStatusMarker
      || (now - lastStatusPrintAtMs >= config.statusHeartbeatSeconds * 1000);
    if (shouldPrintStatus) {
      console.log(summary ? `Status: ${summary}` : `Status after ${formatMinutes(elapsedMs)} minutes: ${formatJson(status)}`);
      lastPrintedStatusMarker = statusMarker;
      lastStatusPrintAtMs = now;
    }
    const latestDebugEntry = getLatestDebugEntry(status);
    const debugMarker = latestDebugEntry ? `${latestDebugEntry.at}|${latestDebugEntry.message}` : '';
    if (debugMarker && debugMarker !== lastDebugMarker) {
      lastDebugMarker = debugMarker;
      console.log(`Latest debug: ${formatDebugEntry(latestDebugEntry)}`);
    }
    const progressMarker = buildProgressMarker(status);
    if (progressMarker !== lastProgressMarker) {
      lastProgressMarker = progressMarker;
      lastProgressAtMs = Date.now();
    } else if (Date.now() - lastProgressAtMs > config.maxStalledMinutes * 60000) {
      throw buildStalledProgressError(status, Date.now() - lastProgressAtMs);
    }

    if (!didStatusHonorResumeCheckpoint(status, expectedResumeCheckpoint)) {
      throw buildResumeCheckpointIgnoredError(status, expectedResumeCheckpoint);
    }

    if (!status?.running) {
      const failure = getFailureFromStatus(status);
      if (failure) throw new Error(`Reindex failed: ${failure}`);
      if (!isReindexComplete(status)) {
        throw buildIncompleteCompletionError(status);
      }
      return status;
    }

    if (statusStartedAtMs && Date.now() - statusStartedAtMs > config.maxRunningMinutes * 60000) {
      throw buildRunningTooLongError(status, statusStartedAtMs, attachedToExistingJob);
    }
  }
}

async function runAttempt(attemptNumber) {
  const token = buildAdminToken();
  const shouldReset = config.reset && (attemptNumber === 1 || config.resetOnRetry);
  const resumeCheckpoint = shouldReset ? null : getPreferredResumeCheckpoint();
  console.log('');
  console.log(`Starting Meili reindex attempt ${attemptNumber} against ${config.appUrl}...`);
  try {
    const existingStatus = await getStatus(token);
    rememberResumeCheckpoint(existingStatus);
    if (existingStatus?.running) {
      if (!didStatusHonorResumeCheckpoint(existingStatus, resumeCheckpoint)) {
        throw buildResumeCheckpointIgnoredError(existingStatus, resumeCheckpoint);
      }
      const existingSummary = buildStatusSummary(existingStatus, parseIsoDate(existingStatus?.lastStartedAt) ? Math.max(0, Date.now() - parseIsoDate(existingStatus.lastStartedAt)) : null);
      console.log('A reindex job is already running. Monitoring the existing job.');
      if (existingSummary) {
        console.log(`Current progress: ${existingSummary}`);
      }
      const existingDebug = getLatestDebugEntry(existingStatus);
      if (existingDebug) {
        console.log(`Latest debug: ${formatDebugEntry(existingDebug)}`);
      }
      const finalStatus = await waitForCompletion(token, existingStatus, true);
      const indexedCount = finalStatus?.lastResult?.totalIndexed;
      if (Number.isFinite(indexedCount)) {
        console.log(`Indexed documents: ${indexedCount}`);
      }
      console.log('Reindex finished successfully.');
      return;
    }
  } catch (error) {
    const message = toErrorMessage(error);
    if (!isTransientNetworkError(message)) throw error;
    console.log(`Initial status check failed, continuing to trigger: ${message}`);
  }

  if (resumeCheckpoint?.lastIndexedId > 0) {
    console.log(`Resuming from checkpoint: indexed=${formatNumber(resumeCheckpoint.totalIndexed)}, lastIndexedId=${formatNumber(resumeCheckpoint.lastIndexedId)}, batches=${formatNumber(resumeCheckpoint.processedBatches)}`);
  }
  console.log(`Triggering reindex (reset=${shouldReset ? '1' : '0'})...`);

  let triggerResponse = null;
  try {
    triggerResponse = await triggerReindex(token, shouldReset, resumeCheckpoint);
  } catch (error) {
    const message = toErrorMessage(error);
    if (!isTransientNetworkError(message)) throw error;
    console.log(`Trigger request failed, checking whether the job is already running: ${message}`);
    const fallbackStatus = await getStatus(token);
    rememberResumeCheckpoint(fallbackStatus);
    if (!fallbackStatus?.running) {
      throw error;
    }
    triggerResponse = {
      ...fallbackStatus,
      ok: true,
      engine: 'meili',
      started: false,
      reset: shouldReset
    };
  }
  console.log(`Trigger response: ${formatJson(triggerResponse)}`);
  rememberResumeCheckpoint(triggerResponse);
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

  const finalStatus = await waitForCompletion(token, triggerResponse, attachedToExistingJob, resumeCheckpoint);
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
      if (isResumeCheckpointIgnoredError(message)) {
        console.log(getResumeCheckpointIgnoredHint());
        process.exitCode = 1;
        return;
      }
      const fatalHint = getFatalReindexHint(message);
      if (fatalHint) {
        console.log(fatalHint);
        process.exitCode = 1;
        return;
      }

      if (isMeiliTaskStallError(message)) {
        const nextBatchSize = getNextLowerBatchSize(config.batchSize, batchDownshiftSequence);
        if (nextBatchSize) {
          console.log(`Detected Meili task stall; lowering batch size from ${config.batchSize} to ${nextBatchSize} for next retry.`);
          config.batchSize = nextBatchSize;
        } else {
          console.log(`Detected Meili task stall; batch size is already at minimum configured level (${config.batchSize}).`);
        }
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
