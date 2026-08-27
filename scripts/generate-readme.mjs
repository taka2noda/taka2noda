#!/usr/bin/env node
// Regenerates the public "Sample Repos" table in README.md from GitHub repo
// topics. Public repos only — this uses only publicly readable data.
//
// A repo is included when it has the "taka2-sample" topic. Its category comes
// from a "category-<name>" topic, and its description comes from the repo's
// GitHub description field. Tag/untag a repo's topics or edit its
// description on GitHub, then re-run this script.
//
// Private repos are out of scope here by design — they're listed by hand in
// the "Private Sample Repos" section of README.md.
//
// Usage: node scripts/generate-readme.mjs (GITHUB_TOKEN optional, raises the
// unauthenticated GitHub API rate limit if set)

import { readFile, writeFile } from "node:fs/promises";

const OWNER = "taka2noda";
const MARKER_TOPIC = "taka2-sample";
const CATEGORY_PREFIX = "category-";
const README_PATH = new URL("../README.md", import.meta.url);

const START = "<!-- SAMPLE_REPOS:START -->";
const END = "<!-- SAMPLE_REPOS:END -->";

const CATEGORY_LABELS = {
  apm: "APM",
  infra: "Infra",
  rum: "RUM",
  "agent-obs": "Agent Obs",
  security: "Security",
  other: "Other",
};

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

async function ghApi(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function listPublicRepos() {
  // Public listing endpoint — returns only public repos, no auth needed.
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await ghApi(
      `/users/${OWNER}/repos?per_page=100&page=${page}&type=owner`,
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

function categoryFromTopics(topics) {
  const catTopic = topics.find((t) => t.startsWith(CATEGORY_PREFIX));
  if (!catTopic) return null;
  const key = catTopic.slice(CATEGORY_PREFIX.length);
  return CATEGORY_LABELS[key] || key;
}

function renderTable(rows) {
  const lines = ["| Category | Repository | Description |", "|---|---|---|"];
  for (const row of rows) {
    lines.push(`| ${row.category} | [${row.name}](${row.url}) | ${row.description} |`);
  }
  return lines.join("\n");
}

async function main() {
  const repos = await listPublicRepos();
  const rows = [];

  for (const repo of repos) {
    if (repo.archived) continue;

    const detail = await ghApi(`/repos/${OWNER}/${repo.name}/topics`);
    const topics = detail.names || [];
    if (!topics.includes(MARKER_TOPIC)) continue;

    const category = categoryFromTopics(topics);
    if (!category) {
      console.warn(`Skipping ${repo.name}: has ${MARKER_TOPIC} but no category-* topic`);
      continue;
    }
    if (!repo.description) {
      console.warn(`Skipping ${repo.name}: no description set`);
      continue;
    }

    rows.push({
      name: repo.name,
      url: repo.html_url,
      description: repo.description,
      category,
      createdAt: repo.created_at,
    });
  }

  // Within a category, newest repo (by creation date) first.
  rows.sort((a, b) =>
    a.category === b.category
      ? new Date(b.createdAt) - new Date(a.createdAt)
      : a.category.localeCompare(b.category),
  );

  const table = renderTable(rows);
  const readme = await readFile(README_PATH, "utf8");
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`README.md is missing ${START} / ${END} markers`);
  }

  const updated =
    readme.slice(0, startIdx + START.length) +
    "\n" +
    table +
    "\n" +
    readme.slice(endIdx);

  await writeFile(README_PATH, updated);
  console.log(`Wrote ${rows.length} repos to README.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
