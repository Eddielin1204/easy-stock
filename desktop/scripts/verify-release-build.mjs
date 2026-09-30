import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function verifyReleaseBuild(tagCommit, run, jobs, artifacts) {
  if (run.head_sha !== tagCommit || run.path !== '.github/workflows/release.yml') {
    throw new Error('The original build does not match the release tag/workflow');
  }
  for (const name of ['Test release source', 'macOS arm64', 'macOS x64', 'Windows x64']) {
    if (!jobs.some((job) => job.name === name && job.conclusion === 'success')) {
      throw new Error(`The original build did not pass: ${name}`);
    }
  }
  for (const name of ['easy-stock-macos-arm64', 'easy-stock-macos-x64', 'easy-stock-windows-x64']) {
    const artifact = artifacts.find((item) => item.name === name);
    if (!artifact || artifact.expired || !(artifact.size_in_bytes > 0) || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '')) {
      throw new Error(`Verified build artifact is missing/expired: ${name}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [runID, tag] = process.argv.slice(2);
  const repo = process.env.GH_REPO;
  if (!repo || !/^\d+$/.test(runID || '') || !/^v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('Usage: GH_REPO=<repo> node verify-release-build.mjs <run-id> <tag>');
  const api = (endpoint) => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${endpoint}`], { encoding: 'utf8' }));
  const run = api(`actions/runs/${runID}`);
  const jobs = api(`actions/runs/${runID}/jobs?filter=latest&per_page=100`).jobs;
  const artifacts = api(`actions/runs/${runID}/artifacts?per_page=100`).artifacts;
  verifyReleaseBuild(api(`commits/${tag}`).sha, run, jobs, artifacts);
  console.log(`Verified original ${tag} packages from run ${runID} at ${run.head_sha}`);
}
