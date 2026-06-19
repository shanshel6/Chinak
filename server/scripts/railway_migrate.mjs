// Direct SQL via Railway's REST API (bypass DNS hijacking).
// Uses Railway's GraphQL API to run raw SQL on your Postgres service.
// No DNS needed — works over HTTPS.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..');

// Read Railway token from .env.migration (or env var)
const envFile = path.join(REPO_ROOT, '.env.migration');
let RAILWAY_TOKEN = process.env.RAILWAY_TOKEN;
if (!RAILWAY_TOKEN && fs.existsSync(envFile)) {
  const buf = fs.readFileSync(envFile);
  let raw;
  if (buf[0] === 0xFF && buf[1] === 0xFE) {
    raw = buf.toString('utf16le').slice(1);
  } else if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    raw = buf.toString('utf8').slice(1);
  } else {
    raw = buf.toString('utf8');
  }
  const m = raw.match(/^RAILWAY_TOKEN\s*=\s*["']?([^"'\r\n]+)["']?/m);
  if (m) RAILWAY_TOKEN = m[1].trim();
}

if (!RAILWAY_TOKEN) {
  console.error('RAILWAY_TOKEN not found in .env.migration or env.');
  console.error('Get it from: https://railway.app/account/tokens');
  process.exit(1);
}

// Read SQL file
const SQL_FILE = path.join(REPO_ROOT, 'prisma', 'fix_image_embedding_column.sql');
if (!fs.existsSync(SQL_FILE)) {
  console.error('SQL file not found:', SQL_FILE);
  process.exit(1);
}
const sql = fs.readFileSync(SQL_FILE, 'utf8');

// Railway GraphQL endpoint
const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';

async function runSqlViaRailway() {
  console.log('[Railway API] Getting project/service ID...');
  
  // 1. Get project ID
  const projectResp = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RAILWAY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        query {
          me {
            projects {
              edges {
                node {
                  id
                  name
                  services {
                    edges {
                      node {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
    }),
  });
  const projectJson = await projectResp.json();
  const projects = projectJson?.data?.me?.projects?.edges || [];
  if (projects.length === 0) {
    console.error('No projects found. Check token permissions.');
    process.exit(1);
  }
  
  // Find the project with Postgres service
  let serviceId = null;
  for (const p of projects) {
    const services = p.node.services.edges || [];
    const pgService = services.find((s) => s.node.name.toLowerCase().includes('postgres'));
    if (pgService) {
      serviceId = pgService.node.id;
      console.log(`[Railway API] Found Postgres service: ${pgService.node.name} (${serviceId})`);
      break;
    }
  }
  
  if (!serviceId) {
    console.error('No Postgres service found in any project.');
    process.exit(1);
  }
  
  // 2. Run raw SQL via Railway's "runCommand" mutation
  console.log('[Railway API] Running SQL migration...');
  const runResp = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RAILWAY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        mutation RunSQL($serviceId: String!, $command: String!) {
          serviceRunCommand(input: {
            serviceId: $serviceId,
            command: $command
          }) {
            id
            status
          }
        }
      `,
      variables: {
        serviceId,
        command: `psql -c "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      },
    }),
  });
  
  const runJson = await runResp.json();
  if (runJson.errors) {
    console.error('[Railway API] Error:', runJson.errors[0].message);
    process.exit(1);
  }
  
  const runId = runJson.data.serviceRunCommand.id;
  console.log(`[Railway API] Command started: ${runId}`);
  console.log('[Railway API] Migration submitted. Check Railway dashboard for logs.');
  console.log('[Railway API] After ~30s, re-run your pipeline script.');
}

runSqlViaRailway().catch((e) => {
  console.error('[Railway API] Fatal:', e.message);
  process.exit(1);
});