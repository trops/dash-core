/**
 * jobStore.js — where jobs are kept (DASH-28, DASH-31): one file per job,
 *
 *   <root>/<jobId>.json
 *
 * sealed at rest like goals and bot runs (secretBox; plain without a
 * keychain), written to a temp file and renamed into place. Jobs are the
 * user's history on their own computer, so nothing here deletes one by
 * itself: only deleteJob, when the user asks.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const JOB_ID = /^job_[a-z0-9]+$/;

/**
 * @param {{ root: string, box?: { seal: Function, open: Function } }} p
 */
function createJobStore({ root, box = null }) {
  const jobs = new Map();
  // Sealed by a keychain this session can't open: never shown, never
  // overwritten.
  const unreadable = new Set();

  const fileOf = (id) => path.join(root, `${id}.json`);

  function readRecord(file) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && typeof raw.sealed === "string") {
      const opened = box ? box.open(raw.sealed) : raw.sealed;
      if (opened == null) throw new Error("sealed by another keychain");
      return JSON.parse(opened);
    }
    return raw;
  }

  function load() {
    jobs.clear();
    unreadable.clear();
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch (_e) {
      return; // No jobs yet.
    }
    for (const name of names) {
      const id = name.replace(/\.json$/, "");
      if (!name.endsWith(".json") || !JOB_ID.test(id)) continue;
      try {
        const job = readRecord(fileOf(id));
        if (job && job.id === id) jobs.set(id, job);
      } catch (_e) {
        unreadable.add(id);
      }
    }
  }

  function save(job) {
    if (!job || !JOB_ID.test(String(job.id || ""))) return false;
    if (unreadable.has(job.id)) return false;
    fs.mkdirSync(root, { recursive: true });
    const file = fileOf(job.id);
    const json = JSON.stringify(job);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ v: 1, sealed: box ? box.seal(json) : json }),
    );
    fs.renameSync(tmp, file);
    jobs.set(job.id, job);
    return true;
  }

  function remove(id) {
    if (!JOB_ID.test(String(id || ""))) return false;
    const had = jobs.delete(id) || unreadable.delete(id);
    try {
      fs.rmSync(fileOf(id), { force: true });
    } catch (_e) {
      // Gone already.
    }
    return had;
  }

  load();
  return {
    JOB_ID,
    load,
    save,
    remove,
    get: (id) => jobs.get(id) || null,
    /** Every job, newest change first. */
    list: () =>
      [...jobs.values()].sort((a, b) =>
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
      ),
  };
}

module.exports = { createJobStore, JOB_ID };
