// Synthesizes the Amplify backend's CloudFormation locally, without deploying,
// by running amplify/backend.ts the way `ampx` does. Useful for checking IAM,
// env vars and infrastructure changes before pushing.
//
//   node scripts/synth.mjs [branch|sandbox] [outDir]
//
// Templates are written to outDir (default: .amplify/synth-<type>).
import { spawnSync } from 'node:child_process';

const type = process.argv[2] ?? 'branch';
const out = process.argv[3] ?? `.amplify/synth-${type}`;
if (!['branch', 'sandbox'].includes(type)) {
  console.error('usage: node scripts/synth.mjs [branch|sandbox] [outDir]');
  process.exit(2);
}

const env = {
  ...process.env,
  CDK_OUTDIR: out,
  CDK_CONTEXT_JSON: JSON.stringify({
    'amplify-backend-namespace': 'd1c2x4zpjcxv7w',
    'amplify-backend-name': `synth-${type}`,
    'amplify-backend-type': type,
  }),
  CDK_DEFAULT_ACCOUNT: process.env.CDK_DEFAULT_ACCOUNT ?? '423971488961',
  CDK_DEFAULT_REGION: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
};

const result = spawnSync('npx', ['tsx', 'amplify/backend.ts'], {
  env,
  encoding: 'utf8',
  timeout: 240_000,
});
const errors = (result.stderr ?? '').split('\n').filter((line) => /error/i.test(line));
if (errors.length) console.error(errors.join('\n'));
if (result.status === 0) console.log(`Synthesized ${type} templates to ${out}`);
process.exit(result.status ?? 1);
